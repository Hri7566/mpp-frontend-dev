// 钢琴

$(() => {
    const test_mode =
        window.location.hash &&
        window.location.hash.match(/^(?:#.+)*#test(?:#.+)*$/i);

    const gSeeOwnCursor =
        window.location.hash &&
        window.location.hash.match(/^(?:#.+)*#seeowncursor(?:#.+)*$/i);

    const gMidiVolumeTest =
        window.location.hash &&
        window.location.hash.match(/^(?:#.+)*#midivolumetest(?:#.+)*$/i);

    let gMidiOutTest;

    // base64 idea from yellowberry
    let base64config, configs;

    try {
        base64config = document.getElementById("config").innerText;
        configs = JSON.parse(atob(base64config));
    } catch (err) {
        console.warn("Unable to parse server config:", err);
    }

    const DEFAULT_VELOCITY = 0.5;
    const TIMING_TARGET = 1000;

    // Utility

    ////////////////////////////////////////////////////////////////

    /**
     * 2D rectangle shape for bounds checking
     * @author Brandon Lockaby
     */
    class Rect {
        constructor(x, y, w, h) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.x2 = x + w;
            this.y2 = y + h;
        }

        contains(x, y) {
            return x >= this.x && x <= this.x2 && y >= this.y && y <= this.y2;
        }
    }

    // performing translation

    ////////////////////////////////////////////////////////////////

    const Translation = (() => {
        const strings = {
            "people are playing": {
                pt: "pessoas estão jogando",
                es: "personas están jugando",
                ru: "человек играет",
                fr: "personnes jouent",
                ja: "人が遊んでいる",
                de: "Leute spielen",
                zh: "人在玩",
                nl: "mensen spelen",
                pl: "osób grają",
                hu: "ember játszik"
            },
            "New Room...": {
                pt: "Nova Sala ...",
                es: "Nueva sala de...",
                ru: "Новый номер...",
                ja: "新しい部屋",
                zh: "新房间",
                nl: "nieuwe Kamer",
                hu: "új szoba"
            },
            "room name": {
                pt: "nome da sala",
                es: "sala de nombre",
                ru: "название комнаты",
                fr: "nom de la chambre",
                ja: "ルーム名",
                de: "Raumnamen",
                zh: "房间名称",
                nl: "kamernaam",
                pl: "nazwa pokój",
                hu: "szoba neve"
            },
            "Visible (open to everyone)": {
                pt: "Visível (aberto a todos)",
                es: "Visible (abierto a todo el mundo)",
                ru: "Visible (открытый для всех)",
                fr: "Visible (ouvert à tous)",
                ja: "目に見える（誰にでも開いている）",
                de: "Sichtbar (offen für alle)",
                zh: "可见（向所有人开放）",
                nl: "Zichtbaar (open voor iedereen)",
                pl: "Widoczne (otwarte dla wszystkich)",
                hu: "Látható (nyitott mindenki számára)"
            },
            "Enable Chat": {
                pt: "Ativar bate-papo",
                es: "Habilitar chat",
                ru: "Включить чат",
                fr: "Activer discuter",
                ja: "チャットを有効にする",
                de: "aktivieren Sie chatten",
                zh: "启用聊天",
                nl: "Chat inschakelen",
                pl: "Włącz czat",
                hu: "a csevegést"
            },
            "Play Alone": {
                pt: "Jogar Sozinho",
                es: "Jugar Solo",
                ru: "Играть в одиночку",
                fr: "Jouez Seul",
                ja: "一人でプレイ",
                de: "Alleine Spielen",
                zh: "独自玩耍",
                nl: "Speel Alleen",
                pl: "Zagraj sam",
                hu: "Játssz egyedül"
            }
            // todo: it, tr, th, sv, ar, fi, nb, da, sv, he, cs, ko, ro, vi, id, nb, el, sk, bg, lt, sl, hr
            // todo: Connecting, Offline mode, input placeholder, Notifications
        };

        const setLanguage = lang => {
            language = lang;
        };

        const getLanguage = () => {
            if (
                window.navigator &&
                navigator.language &&
                navigator.language.length >= 2
            ) {
                return navigator.language.substr(0, 2).toLowerCase();
            } else {
                return "en";
            }
        };

        const get = (text, lang) => {
            if (typeof lang === "undefined") lang = language;
            const row = strings[text];
            if (row == undefined) return text;
            const string = row[lang];
            if (string == undefined) return text;
            return string;
        };

        const perform = lang => {
            if (typeof lang === "undefined") lang = language;

            $(".translate").each((i, ele) => {
                const th = $(this);

                if (ele.tagName && ele.tagName.toLowerCase() == "input") {
                    if (typeof ele.placeholder != "undefined") {
                        th.attr(
                            "placeholder",
                            get(th.attr("placeholder"), lang)
                        );
                    }
                } else {
                    th.text(get(th.text(), lang));
                }
            });
        };

        const language = getLanguage();

        return {
            setLanguage,
            getLanguage,
            get,
            perform
        };
    })();

    Translation.perform();

    // AudioEngine classes

    ////////////////////////////////////////////////////////////////

    /**
     * Abstract audio engine
     * @abstract
     * @author Brandon Lockaby
     */
    class AudioEngine {
        constructor() {}

        init(cb) {
            this.volume = 0.6;
            this.sounds = {};
            this.paused = true;
            return this;
        }

        load(id, url, cb) {}

        play() {}

        stop() {}

        setVolume(vol) {
            this.volume = vol;
        }

        resume() {
            this.paused = false;
        }
    }

    /**
     * WebAudio engine
     * @author Brandon Lockaby
     * @extends AudioEngine
     */
    class AudioEngineWeb extends AudioEngine {
        constructor() {
            super();

            this.threshold = 1000;
            this.worker = new Worker("/workerTimer.js");

            const self = this;

            this.worker.onmessage = event => {
                if (event.data.args)
                    if (event.data.args.action == 0) {
                        self.actualPlay(
                            event.data.args.id,
                            event.data.args.vol,
                            event.data.args.time,
                            event.data.args.part_id
                        );
                    } else {
                        self.actualStop(
                            event.data.args.id,
                            event.data.args.time,
                            event.data.args.part_id
                        );
                    }
            };
        }

        init(cb) {
            AudioEngine.prototype.init.call(this);

            this.context = new AudioContext({ latencyHint: "interactive" });

            this.masterGain = this.context.createGain();
            this.masterGain.connect(this.context.destination);
            this.masterGain.gain.value = this.volume;

            this.limiterNode = this.context.createDynamicsCompressor();
            this.limiterNode.threshold.value = -10;
            this.limiterNode.knee.value = 0;
            this.limiterNode.ratio.value = 20;
            this.limiterNode.attack.value = 0;
            this.limiterNode.release.value = 0.1;
            this.limiterNode.connect(this.masterGain);

            // for synth mix
            this.pianoGain = this.context.createGain();
            this.pianoGain.gain.value = 0.5;
            this.pianoGain.connect(this.limiterNode);
            this.synthGain = this.context.createGain();
            this.synthGain.gain.value = 0.5;
            this.synthGain.connect(this.limiterNode);

            this.playings = {};

            if (cb) setTimeout(cb, 0);
            return this;
        }

        load(id, url, cb) {
            const audio = this;
            const req = new XMLHttpRequest();
            req.open("GET", url);
            req.responseType = "arraybuffer";
            req.addEventListener("readystatechange", evt => {
                if (req.readyState !== 4) return;
                try {
                    audio.context.decodeAudioData(req.response, buffer => {
                        audio.sounds[id] = buffer;
                        if (cb) cb();
                    });
                } catch (e) {
                    /*throw new Error(e.message
                        + " / id: " + id
                        + " / url: " + url
                        + " / status: " + req.status
                        + " / ArrayBuffer: " + (req.response instanceof ArrayBuffer)
                        + " / byteLength: " + (req.response && req.response.byteLength ? req.response.byteLength : "undefined"));*/
                    new Notification({
                        id: "audio-download-error",
                        title: "Problem",
                        text:
                            "For some reason, an audio download failed with a status of " +
                            req.status +
                            ". ",
                        target: "#piano",
                        duration: 10000
                    });
                }
            });
            req.send();
        }

        actualPlay(id, vol, time, part_id) {
            //the old play(), but with time insted of delay_ms.
            if (this.paused) return;
            if (!this.sounds.hasOwnProperty(id)) return;

            const source = this.context.createBufferSource();
            source.buffer = this.sounds[id];

            const gain = this.context.createGain();
            gain.gain.value = vol;

            source.connect(gain);
            gain.connect(this.pianoGain);

            source.start(time);

            // Patch from ste-art remedies stuttering under heavy load
            if (this.playings[id]) {
                const playing = this.playings[id];

                playing.gain.gain.setValueAtTime(playing.gain.gain.value, time);
                playing.gain.gain.linearRampToValueAtTime(0.0, time + 0.2);
                playing.source.stop(time + 0.21);

                if (enableSynth && playing.voice) {
                    playing.voice.stop(time);
                }
            }

            this.playings[id] = {
                source: source,
                gain: gain,
                part_id: part_id
            };

            if (enableSynth) {
                this.playings[id].voice = new synthVoice(id, time);
            }
        }

        play(id, vol, delay_ms, part_id) {
            if (!this.sounds.hasOwnProperty(id)) return;

            const time = this.context.currentTime + delay_ms / 1000; //calculate time on note receive.
            const delay = delay_ms - this.threshold;

            if (delay <= 0) {
                this.actualPlay(id, vol, time, part_id);
            } else {
                this.worker.postMessage({
                    delay: delay,
                    args: {
                        action: 0 /*play*/,
                        id,
                        vol,
                        time,
                        part_id
                    }
                }); // but start scheduling right before play.
            }
        }

        actualStop(id, time, part_id) {
            if (
                this.playings.hasOwnProperty(id) &&
                this.playings[id] &&
                this.playings[id].part_id === part_id
            ) {
                const gain = this.playings[id].gain.gain;

                gain.setValueAtTime(gain.value, time);
                gain.linearRampToValueAtTime(gain.value * 0.1, time + 0.16);
                gain.linearRampToValueAtTime(0.0, time + 0.4);

                this.playings[id].source.stop(time + 0.41);

                if (this.playings[id].voice) {
                    this.playings[id].voice.stop(time);
                }

                this.playings[id] = null;
            }
        }

        stop(id, delay_ms, part_id) {
            const time = this.context.currentTime + delay_ms / 1000;
            const delay = delay_ms - this.threshold;

            if (delay <= 0) {
                this.actualStop(id, time, part_id);
            } else {
                this.worker.postMessage({
                    delay: delay,
                    args: {
                        action: 1 /*stop*/,
                        id: id,
                        time: time,
                        part_id: part_id
                    }
                });
            }
        }

        setVolume(vol) {
            super.setVolume(vol);
            this.masterGain.gain.value = this.volume;
        }

        resume() {
            this.paused = false;
            this.context.resume();
        }
    }

    // Renderer classes

    ////////////////////////////////////////////////////////////////

    /**
     * Base abstract rendering class
     * @author Brandon Lockaby
     */
    class Renderer {
        constructor() {}

        /**
         * Initialize the renderer
         * @param {Piano} piano Piano object
         * @returns {Renderer}
         */
        init(piano) {
            this.piano = piano;
            this.resize();
            return this;
        }

        /**
         * Change the internal width and height of the renderer
         * @param {number} width Width of the piano
         * @param {number} height Height of the piano
         */
        resize(width, height) {
            if (typeof width == "undefined")
                width = $(this.piano.rootElement).width();

            if (typeof height == "undefined") height = Math.floor(width * 0.2);

            $(this.piano.rootElement).css({
                height: height + "px",
                marginTop:
                    Math.floor($(window).height() / 2 - height / 2) + "px"
            });

            this.width = width * window.devicePixelRatio;
            this.height = height * window.devicePixelRatio;
        }

        /**
         * Visualize a note being played
         * @abstract
         * @param {PianoKey} key Key object
         * @param {string} color Hex color of the note
         */
        visualize(key, color) {}
    }

    /**
     * Piano canvas rendering class
     * @extends Renderer
     * @author Brandon Lockaby
     */
    class CanvasRenderer extends Renderer {
        constructor() {
            super();
        }

        /**
         * Check whether this renderer is supported in this environment
         * @returns {boolean}
         */
        static isSupported() {
            const canvas = document.createElement("canvas");
            return !!(canvas.getContext && canvas.getContext("2d"));
        }

        /**
         * Get the true cursor click position based on the offset of this renderer on the page
         * @param {MouseEvent} evt Browser mouse event
         * @returns {{x: number; y: number}} Translated mouse vector
         */
        static translateMouseEvent(evt) {
            let element = evt.target;
            let offx = 0;
            let offy = 0;

            do {
                if (!element) break; // wtf, wtf?

                offx += element.offsetLeft;
                offy += element.offsetTop;
            } while ((element = element.offsetParent));

            return {
                x: (evt.pageX - offx) * window.devicePixelRatio,
                y: (evt.pageY - offy) * window.devicePixelRatio
            };
        }

        /**
         * Initialize this renderer
         * @param {Piano} piano Piano object
         * @returns {CanvasRenderer}
         */
        init(piano) {
            this.canvas = document.createElement("canvas");
            this.ctx = this.canvas.getContext("2d");
            piano.rootElement.appendChild(this.canvas);

            super.init(piano); // calls resize()

            // create render loop
            const self = this;
            const render = () => {
                self.redraw();
                requestAnimationFrame(render);
            };

            requestAnimationFrame(render);

            // add event listeners
            let mouse_down = false;
            let last_key = null;

            $(piano.rootElement).mousedown(event => {
                mouse_down = true;
                //event.stopPropagation();
                event.preventDefault();

                const pos = CanvasRenderer.translateMouseEvent(event);
                const hit = self.getHit(pos.x, pos.y);

                if (hit) {
                    press(hit.key.note, hit.v);
                    last_key = hit.key;
                }
            });

            piano.rootElement.addEventListener(
                "touchstart",
                event => {
                    mouse_down = true;
                    //event.stopPropagation();
                    event.preventDefault();
                    for (let i in event.changedTouches) {
                        let pos = CanvasRenderer.translateMouseEvent(
                            event.changedTouches[i]
                        );

                        let hit = self.getHit(pos.x, pos.y);

                        if (hit) {
                            press(hit.key.note, hit.v);
                            last_key = hit.key;
                        }
                    }
                },
                false
            );

            $(window).mouseup(event => {
                if (last_key) {
                    release(last_key.note);
                }

                mouse_down = false;
                last_key = null;
            });

            /*
            $(piano.rootElement).mousemove(event => {
                if (!mouse_down) return;

                const pos = CanvasRenderer.translateMouseEvent(event);
                const hit = self.getHit(pos.x, pos.y);

                if (hit && hit.key != last_key) {
                    press(hit.key.note, hit.v);
                    last_key = hit.key;
                }
            });
            */

            return this;
        }

        /**
         * Resize this renderer
         * @param {number} width New width
         * @param {number} height New height
         */
        resize(width, height) {
            super.resize(width, height);

            if (this.width < 52 * 2) this.width = 52 * 2;
            if (this.height < this.width * 0.2)
                this.height = Math.floor(this.width * 0.2);

            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.canvas.style.width =
                this.width / window.devicePixelRatio + "px";
            this.canvas.style.height =
                this.height / window.devicePixelRatio + "px";

            // calculate key sizes
            this.whiteKeyWidth = Math.floor(this.width / 52);
            this.whiteKeyHeight = Math.floor(this.height * 0.9);
            this.blackKeyWidth = Math.floor(this.whiteKeyWidth * 0.75);
            this.blackKeyHeight = Math.floor(this.height * 0.5);

            this.blackKeyOffset = Math.floor(
                this.whiteKeyWidth - this.blackKeyWidth / 2
            );

            this.keyMovement = Math.floor(this.whiteKeyHeight * 0.015);

            this.whiteBlipWidth = Math.floor(this.whiteKeyWidth * 0.7);
            this.whiteBlipHeight = Math.floor(this.whiteBlipWidth * 0.8);

            this.whiteBlipX = Math.floor(
                (this.whiteKeyWidth - this.whiteBlipWidth) / 2
            );

            this.whiteBlipY = Math.floor(
                this.whiteKeyHeight - this.whiteBlipHeight * 1.2
            );

            this.blackBlipWidth = Math.floor(this.blackKeyWidth * 0.7);
            this.blackBlipHeight = Math.floor(this.blackBlipWidth * 0.8);

            this.blackBlipY = Math.floor(
                this.blackKeyHeight - this.blackBlipHeight * 1.2
            );

            this.blackBlipX = Math.floor(
                (this.blackKeyWidth - this.blackBlipWidth) / 2
            );

            // prerender white key
            this.whiteKeyRender = document.createElement("canvas");
            this.whiteKeyRender.width = this.whiteKeyWidth;
            this.whiteKeyRender.height = this.height + 10;

            let ctx = this.whiteKeyRender.getContext("2d");
            let gradient = ctx.createLinearGradient(
                0,
                0,
                0,
                this.whiteKeyHeight
            );

            gradient.addColorStop(0, "#eee");
            gradient.addColorStop(0.75, "#fff");
            gradient.addColorStop(1, "#dad4d4");

            ctx.fillStyle = gradient;

            ctx.strokeStyle = "#000";
            ctx.lineJoin = "round";
            ctx.lineCap = "round";

            ctx.lineWidth = 10;

            ctx.strokeRect(
                ctx.lineWidth / 2,
                ctx.lineWidth / 2,
                this.whiteKeyWidth - ctx.lineWidth,
                this.whiteKeyHeight - ctx.lineWidth
            );

            ctx.lineWidth = 4;

            ctx.fillRect(
                ctx.lineWidth / 2,
                ctx.lineWidth / 2,
                this.whiteKeyWidth - ctx.lineWidth,
                this.whiteKeyHeight - ctx.lineWidth
            );

            // prerender black key
            this.blackKeyRender = document.createElement("canvas");
            this.blackKeyRender.width = this.blackKeyWidth + 10;
            this.blackKeyRender.height = this.blackKeyHeight + 10;

            ctx = this.blackKeyRender.getContext("2d");

            gradient = ctx.createLinearGradient(0, 0, 0, this.blackKeyHeight);

            gradient.addColorStop(0, "#000");
            gradient.addColorStop(1, "#444");

            ctx.fillStyle = gradient;

            ctx.strokeStyle = "#222";
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.lineWidth = 8;

            ctx.strokeRect(
                ctx.lineWidth / 2,
                ctx.lineWidth / 2,
                this.blackKeyWidth - ctx.lineWidth,
                this.blackKeyHeight - ctx.lineWidth
            );

            ctx.lineWidth = 4;

            ctx.fillRect(
                ctx.lineWidth / 2,
                ctx.lineWidth / 2,
                this.blackKeyWidth - ctx.lineWidth,
                this.blackKeyHeight - ctx.lineWidth
            );

            // prerender shadows
            this.shadowRender = [];

            const y = -this.canvas.height * 2;

            for (let j = 0; j < 2; j++) {
                const canvas = document.createElement("canvas");

                this.shadowRender[j] = canvas;

                canvas.width = this.canvas.width;
                canvas.height = this.canvas.height;

                ctx = canvas.getContext("2d");

                const sharp = j ? true : false;

                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                ctx.lineWidth = 1;

                ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
                ctx.shadowBlur = this.keyMovement * 3;
                ctx.shadowOffsetY = -y + this.keyMovement;

                if (sharp) {
                    ctx.shadowOffsetX = this.keyMovement;
                } else {
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = -y + this.keyMovement;
                }

                for (let i in this.piano.keys) {
                    if (!this.piano.keys.hasOwnProperty(i)) continue;

                    const key = this.piano.keys[i];

                    if (key.sharp != sharp) continue;

                    if (key.sharp) {
                        ctx.fillRect(
                            this.blackKeyOffset +
                                this.whiteKeyWidth * key.spatial +
                                ctx.lineWidth / 2,
                            y + ctx.lineWidth / 2,
                            this.blackKeyWidth - ctx.lineWidth,
                            this.blackKeyHeight - ctx.lineWidth
                        );
                    } else {
                        ctx.fillRect(
                            this.whiteKeyWidth * key.spatial +
                                ctx.lineWidth / 2,
                            y + ctx.lineWidth / 2,
                            this.whiteKeyWidth - ctx.lineWidth,
                            this.whiteKeyHeight - ctx.lineWidth
                        );
                    }
                }
            }

            // update key rects
            for (let i in this.piano.keys) {
                if (!this.piano.keys.hasOwnProperty(i)) continue;

                let key = this.piano.keys[i];

                if (key.sharp) {
                    key.rect = new Rect(
                        this.blackKeyOffset + this.whiteKeyWidth * key.spatial,
                        0,
                        this.blackKeyWidth,
                        this.blackKeyHeight
                    );
                } else {
                    key.rect = new Rect(
                        this.whiteKeyWidth * key.spatial,
                        0,
                        this.whiteKeyWidth,
                        this.whiteKeyHeight
                    );
                }
            }
        }

        /**
         * Visualize a note being played
         * @param {PianoKey} key Key object
         * @param {string} color Hex color
         */
        visualize(key, color) {
            key.timePlayed = Date.now();
            key.blips.push({ time: key.timePlayed, color: color });
        }

        /**
         * Redraw the entire canvas
         */
        redraw() {
            const now = Date.now();
            const timeLoadedEnd = now - 1000;
            const timePlayedEnd = now - 100;
            const timeBlipEnd = now - 1000;

            this.ctx.save();
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // draw all keys
            for (let j = 0; j < 2; j++) {
                this.ctx.globalAlpha = 1.0;
                this.ctx.drawImage(this.shadowRender[j], 0, 0);

                const sharp = j ? true : false;

                for (const key of Object.values(this.piano.keys)) {
                    if (key.sharp != sharp) continue;

                    if (!key.loaded) {
                        this.ctx.globalAlpha = 0.2;
                    } else if (key.timeLoaded > timeLoadedEnd) {
                        this.ctx.globalAlpha =
                            ((now - key.timeLoaded) / 1000) * 0.8 + 0.2;
                    } else {
                        this.ctx.globalAlpha = 1.0;
                    }

                    let y = 0;

                    if (key.timePlayed > timePlayedEnd) {
                        y = Math.floor(
                            this.keyMovement -
                                ((now - key.timePlayed) / 100) *
                                    this.keyMovement
                        );
                    }

                    let x = Math.floor(
                        key.sharp
                            ? this.blackKeyOffset +
                                  this.whiteKeyWidth * key.spatial
                            : this.whiteKeyWidth * key.spatial
                    );

                    const image = key.sharp
                        ? this.blackKeyRender
                        : this.whiteKeyRender;

                    this.ctx.drawImage(image, x, y);

                    // render blips
                    if (key.blips.length) {
                        const alpha = this.ctx.globalAlpha;
                        let w, h;

                        if (key.sharp) {
                            x += this.blackBlipX;
                            y = this.blackBlipY;
                            w = this.blackBlipWidth;
                            h = this.blackBlipHeight;
                        } else {
                            x += this.whiteBlipX;
                            y = this.whiteBlipY;
                            w = this.whiteBlipWidth;
                            h = this.whiteBlipHeight;
                        }

                        for (let b = 0; b < key.blips.length; b++) {
                            const blip = key.blips[b];

                            if (blip.time > timeBlipEnd) {
                                this.ctx.fillStyle = blip.color;
                                this.ctx.globalAlpha =
                                    alpha - (now - blip.time) / 1000;
                                this.ctx.fillRect(x, y, w, h);
                            } else {
                                key.blips.splice(b, 1);
                                --b;
                            }

                            y -= Math.floor(h * 1.1);
                        }
                    }
                }
            }

            this.ctx.restore();
        }

        /**
         * Render a lyrical note (unused/unfinished)
         * @author Brandon Lockaby
         */
        renderNoteLyrics() {
            // render lyric
            for (let part_id in this.noteLyrics) {
                if (!this.noteLyrics.hasOwnProperty(i)) continue;

                let lyric = this.noteLyrics[part_id];
                let lyric_x = x;
                let lyric_y = this.whiteKeyHeight + 1;

                this.ctx.fillStyle = key.lyric.color;

                let alpha = this.ctx.globalAlpha;

                this.ctx.globalAlpha = alpha - (now - key.lyric.time) / 1000;
                this.ctx.fillRect(x, y, 10, 10);
            }
        }

        getHit(x, y) {
            for (let j = 0; j < 2; j++) {
                const sharp = j ? false : true; // black keys first

                for (const key of Object.values(this.piano.keys)) {
                    if (key.sharp != sharp) continue;

                    if (key.rect.contains(x, y)) {
                        let v =
                            y /
                            (key.sharp
                                ? this.blackKeyHeight
                                : this.whiteKeyHeight);

                        v += 0.25;
                        v *= DEFAULT_VELOCITY;

                        if (v > 1.0) v = 1.0;
                        return { key: key, v: v };
                    }
                }
            }

            return null;
        }
    }

    // Soundpack Stuff by electrashave ♥

    ////////////////////////////////////////////////////////////////

    /**
     * Soundpack selector
     * @author electrashave
     */
    class SoundSelector {
        /**
         * @param {Piano} piano Piano object
         */
        constructor(piano) {
            this.initialized = false;
            this.keys = piano.keys;
            this.loading = {};
            this.notification;
            this.packs = [];
            this.piano = piano;

            this.soundSelection = localStorage.soundSelection
                ? localStorage.soundSelection
                : "MPP Classic";

            this.addPack({
                name: "MPP Classic",
                keys: Object.keys(this.piano.keys),
                ext: ".mp3",
                url: "/sounds/mppclassic/"
            });
        }

        /**
         * Add a pack to the soundpack list
         * @param {Soundpack} pack Soundpack to add
         * @param {boolean} load Whether to load pack immediately
         */
        addPack(pack, load) {
            this.loading[pack.url || pack] = true;

            const add = pack => {
                let added = false;

                for (let i = 0; this.packs.length > i; i++) {
                    if (pack.name === this.packs[i].name) {
                        added = true;
                        break;
                    }
                }

                if (added) return console.warn("Sounds already added!!"); //no adding soundpacks twice D:<

                if (pack.url.substr(pack.url.length - 1) !== "/")
                    pack.url = pack.url + "/";

                const html = document.createElement("li");

                html.classList = "pack";
                html.innerText = pack.name + " (" + pack.keys.length + " keys)";

                html.onclick = () => {
                    this.loadPack(pack.name);
                    this.notification.close();
                };

                pack.html = html;

                this.packs.push(pack);

                this.packs.sort((a, b) => {
                    if (a.name < b.name) return -1;
                    if (a.name > b.name) return 1;
                    return 0;
                });

                if (load) this.loadPack(pack.name);

                delete this.loading[pack.url];
            };

            if (typeof pack == "string") {
                $.getJSON(pack + "/info.json").done(json => {
                    json.url = pack;
                    add(json);
                });
            } else add(pack); //validate packs??
        }

        /**
         * Add multiple soundpacks
         * @param {Soundpack[]} packs Array of soundpacks
         */
        addPacks(packs) {
            for (let i = 0; packs.length > i; i++) this.addPack(packs[i]);
        }

        /**
         * Initialize this soundpack selector
         * @returns {SoundSelector}
         */
        init() {
            if (this.initialized)
                return console.warn("Sound selector already initialized!");

            if (!!Object.keys(this.loading).length)
                return setTimeout(() => {
                    this.init();
                }, 250);

            $("#sound-btn").on("click", () => {
                if (
                    document.getElementById("Notification-Sound-Selector") !==
                    null
                )
                    return this.notification.close();

                const html = document.createElement("ul");
                //$(html).append("<p>Current Sound: " + self.soundSelection + "</p>");

                for (const pack of this.packs) {
                    if (pack.name == this.soundSelection)
                        pack.html.classList = "pack enabled";
                    else pack.html.classList = "pack";
                    html.appendChild(pack.html);
                }

                this.notification = new Notification({
                    title: "Sound Selector",
                    html: html,
                    id: "Sound-Selector",
                    duration: -1,
                    target: "#sound-btn"
                });
            });

            this.initialized = true;
            this.loadPack(this.soundSelection, true);
        }

        /**
         * Load a soundpack
         * @param {Soundpack|string} pack Load a soundpack
         * @param {boolean} f force(?)
         * @returns
         */
        loadPack(pack, f) {
            pack = this.packs.find(p => p.name === pack);

            if (typeof pack !== "object") {
                console.warn(
                    "Sound pack does not exist! Loading default pack..."
                );

                return this.loadPack("MPP Classic");
            }

            if (pack.name === this.soundSelection && !f) return;
            if (pack.keys.length !== Object.keys(this.piano.keys).length) {
                this.piano.keys = {};

                for (let i = 0; pack.keys.length > i; i++)
                    this.piano.keys[pack.keys[i]] = this.keys[pack.keys[i]];

                this.piano.renderer.resize();
            }

            for (const key of Object.values(this.piano.keys)) {
                (() => {
                    key.loaded = false;

                    this.piano.audio.load(
                        key.note,
                        pack.url + key.note + pack.ext,
                        () => {
                            key.loaded = true;
                            key.timeLoaded = Date.now();
                        }
                    );
                })();
            }

            if (localStorage) localStorage.soundSelection = pack.name;

            this.soundSelection = pack.name;
        }

        /**
         * Remove a soundpack
         * @param {string} name Name of soundpack
         */
        removePack(name) {
            let found = false;

            for (let i = 0; this.packs.length > i; i++) {
                const pack = this.packs[i];

                if (pack.name == name) {
                    this.packs.splice(i, 1);
                    if (pack.name == this.soundSelection)
                        this.loadPack(this.packs[0].name); //add mpp default if none?
                    break;
                }
            }

            if (!found) console.warn("Sound pack not found!");
        }
    }

    // Pianoctor

    ////////////////////////////////////////////////////////////////

    /**
     * Piano key data
     * @author Brandon Lockaby
     */
    class PianoKey {
        constructor(note, octave) {
            this.note = note + octave;
            this.baseNote = note;
            this.octave = octave;
            this.sharp = note.indexOf("s") != -1;
            this.loaded = false;
            this.timeLoaded = 0;
            this.domElement = null;
            this.timePlayed = 0;
            this.blips = [];
        }
    }

    /**
     * Main piano class
     * @author Brandon Lockaby
     */
    class Piano {
        constructor(rootElement) {
            this.rootElement = rootElement;
            this.keys = {};

            let white_spatial = 0;
            let black_spatial = 0;
            let black_it = 0;
            let black_lut = [2, 1, 2, 1, 1];

            const addKey = (note, octave) => {
                let key = new PianoKey(note, octave);

                this.keys[key.note] = key;

                if (key.sharp) {
                    key.spatial = black_spatial;
                    black_spatial += black_lut[black_it % 5];
                    ++black_it;
                } else {
                    key.spatial = white_spatial;
                    ++white_spatial;
                }
            };

            if (test_mode) {
                addKey("c", 2);
            } else {
                addKey("a", -1);
                addKey("as", -1);
                addKey("b", -1);

                const notes = "c cs d ds e f fs g gs a as b".split(" ");

                for (let oct = 0; oct < 7; oct++) {
                    for (const note of notes) {
                        addKey(note, oct);
                    }
                }

                addKey("c", 7);
            }

            this.renderer = new CanvasRenderer().init(this);

            window.addEventListener("resize", () => {
                this.renderer.resize();
            });

            window.AudioContext =
                window.AudioContext || window.webkitAudioContext || undefined;

            const audio_engine = AudioEngineWeb;
            this.audio = new audio_engine().init();
        }

        /**
         * Play a note on the piano
         * @param {string} note Note name
         * @param {number} vol Volume of note
         * @param {*} participant Participant that played the note
         * @param {*} delay_ms Note time offset
         * @param {*} lyric Unused
         */
        play(note, vol, participant, delay_ms, lyric) {
            if (!this.keys.hasOwnProperty(note) || !participant) return;

            const key = this.keys[note];

            if (key.loaded)
                this.audio.play(key.note, vol, delay_ms, participant.id);

            if (gMidiOutTest) gMidiOutTest(key.note, vol * 100, delay_ms);

            setTimeout(() => {
                this.renderer.visualize(key, participant.color);

                if (lyric) {
                }

                const jq_namediv = $(participant.nameDiv);

                jq_namediv.addClass("play");

                setTimeout(() => {
                    jq_namediv.removeClass("play");
                }, 30);
            }, delay_ms || 0);
        }

        /**
         * Stop playing a note on the piano
         * @param {string} note Note name
         * @param {*} participant Participant that played the stop note
         * @param {*} delay_ms Note time offset
         */
        stop(note, participant, delay_ms) {
            if (!this.keys.hasOwnProperty(note)) return;

            let key = this.keys[note];

            if (key.loaded) this.audio.stop(key.note, delay_ms, participant.id);
            if (gMidiOutTest) gMidiOutTest(key.note, 0, delay_ms);
        }
    }

    const gPiano = new Piano(document.getElementById("piano"));
    const gSoundSelector = new SoundSelector(gPiano);

    gSoundSelector.addPacks([
        "/sounds/Emotional_2.0/",
        "/sounds/Harp/",
        "/sounds/Music_Box/",
        "/sounds/Vintage_Upright/",
        "/sounds/Steinway_Grand/",
        "/sounds/Emotional/",
        "/sounds/Untitled/"
    ]);

    gSoundSelector.init();

    let gAutoSustain = false;
    let gSustain = false;

    const gHeldNotes = {};
    const gSustainedNotes = {};

    /**
     * Play a note on the piano (and propagate to the server)
     * @param {string} id Note name
     * @param {number} vol Volume of note
     */
    const press = (id, vol) => {
        if (!gClient.preventsPlaying() && gNoteQuota.spend(1)) {
            gHeldNotes[id] = true;
            gSustainedNotes[id] = true;
            gPiano.play(
                id,
                vol !== undefined ? vol : DEFAULT_VELOCITY,
                gClient.getOwnParticipant(),
                0
            );
            gClient.startNote(id, vol);
        }
    };

    /**
     * Stop playing a note on the piano (and propagate to the server)
     * @param {string} id Note name
     */
    const release = id => {
        if (gHeldNotes[id]) {
            gHeldNotes[id] = false;
            if ((gAutoSustain || gSustain) && !enableSynth) {
                gSustainedNotes[id] = true;
            } else {
                if (gNoteQuota.spend(1)) {
                    gPiano.stop(id, gClient.getOwnParticipant(), 0);
                    gClient.stopNote(id);
                    gSustainedNotes[id] = false;
                }
            }
        }
    };

    /**
     * Enable sustain
     */
    const pressSustain = () => {
        gSustain = true;
    };

    /**
     * Disable sustain
     */
    const releaseSustain = () => {
        gSustain = false;

        if (!gAutoSustain) {
            for (let id in gSustainedNotes) {
                if (
                    gSustainedNotes.hasOwnProperty(id) &&
                    gSustainedNotes[id] &&
                    !gHeldNotes[id]
                ) {
                    gSustainedNotes[id] = false;

                    if (gNoteQuota.spend(1)) {
                        gPiano.stop(id, gClient.getOwnParticipant(), 0);
                        gClient.stopNote(id);
                    }
                }
            }
        }
    };

    // internet science

    ////////////////////////////////////////////////////////////////

    let channel_id = decodeURIComponent(window.location.pathname);
    if (channel_id.substring(0, 1) === "/")
        channel_id = channel_id.substring(1);
    if (channel_id === "") channel_id = "lobby";

    const isSecure = globalThis.location.protocol == "https:";
    const port = window.location.hostname.includes("multiplayerpiano.dev")
        ? 443
        : 8443;
    const gClient = new Client(
        (isSecure ? "wss://" : "ws://") + window.location.hostname + ":" + port
    );

    let enableTokens = true;
    let enableChallenge = true;

    if (configs.usersConfig.tokenAuth == "none") enableTokens = false;
    if (configs.usersConfig.browserChallenge == "none") enableChallenge = false;

    gClient.setChannel(channel_id);
    gClient.start(enableTokens, enableChallenge);

    gClient.on("disconnect", evt => {
        console.log(evt);
    });

    // Setting status
    gClient.on("status", status => {
        $("#status").text(status);
    });

    gClient.on("count", count => {
        if (count > 0) {
            $("#status").html(
                '<span class="number">' +
                    count +
                    "</span> " +
                    (count == 1 ? "person is" : "people are") +
                    " playing"
            );

            document.title = "Piano (" + count + ")";
        } else {
            document.title = "Multiplayer Piano";
        }
    });

    // Handle changes to participants
    gClient.on("participant added", part => {
        part.displayX = 150;
        part.displayY = 50;

        // add nameDiv
        let div = document.createElement("div");

        div.className = "name";
        div.participantId = part.id;
        div.textContent = part.name || "";
        div.style.backgroundColor = part.color || "#777";

        if (gClient.participantId === part.id) {
            $(div).addClass("me");
        }

        if (
            gClient.channel &&
            gClient.channel.crown &&
            gClient.channel.crown.participantId === part.id
        ) {
            $(div).addClass("owner");
        }

        if (gPianoMutes.indexOf(part._id) !== -1) {
            $(part.nameDiv).addClass("muted-notes");
        }

        if (gChatMutes.indexOf(part._id) !== -1) {
            $(part.nameDiv).addClass("muted-chat");
        }

        div.style.display = "none";
        part.nameDiv = $("#names")[0].appendChild(div);

        $(part.nameDiv).fadeIn(2000);

        if (part.tag) {
            if (configs.usersConfig.enableTags) {
                // console.log(part.tag);
                const tag = document.createElement("div");

                $(tag).addClass("nametag");
                $(tag).text(part.tag.text);
                $(tag).css("background", part.tag.color);

                part.tagDiv = $(part.nameDiv).prepend(tag);
            }

            if (part.tag.text === "ADMIN") {
                $(part.nameDiv).addClass("admin");
            }

            if (part.tag.text === "OWNER") {
                $(part.nameDiv).addClass("webmaster");
            }

            if (part.tag.text === "MOD" || part.tag.text === "MODERATOR") {
                $(part.nameDiv).addClass("moderator");
            }

            if (
                part.tag.text === "BOT" ||
                part.tag.text === "ROBOT" ||
                part.tag.text === "PROG" ||
                part.tag.text === "PROGRAM" ||
                part.tag.text === "🤖"
            ) {
                $(part.nameDiv).addClass("bot");
            }
        }

        // sort names
        const arr = $("#names .name");

        arr.sort((a, b) => {
            a = a.style.backgroundColor; // todo: sort based on user id instead
            b = b.style.backgroundColor;
            if (a > b) return 1;
            else if (a < b) return -1;
            else return 0;
        });

        $("#names").html(arr);

        // add cursorDiv
        if (gClient.participantId !== part.id || gSeeOwnCursor) {
            let cursorDiv = document.createElement("div");

            cursorDiv.className = "cursor";
            cursorDiv.style.display = "none";
            part.cursorDiv = $("#cursors")[0].appendChild(cursorDiv);

            $(part.cursorDiv).fadeIn(2000);

            let cursorNameDiv = document.createElement("div");

            cursorNameDiv.className = "name";
            cursorNameDiv.style.backgroundColor = part.color || "#777";
            cursorNameDiv.textContent = part.name || "";

            part.cursorDiv.appendChild(cursorNameDiv);
        } else {
            part.cursorDiv = undefined;
        }
    });

    gClient.on("participant removed", part => {
        // remove nameDiv
        const nd = $(part.nameDiv);
        const cd = $(part.cursorDiv);

        cd.fadeOut(2000);

        nd.fadeOut(2000, () => {
            nd.remove();
            cd.remove();
            part.nameDiv = undefined;
            part.cursorDiv = undefined;
        });
    });

    gClient.on("participant update", part => {
        const name = part.name || "";
        const color = part.color || "#777";

        part.nameDiv.style.backgroundColor = color;
        part.nameDiv.textContent = name;

        $(part.cursorDiv)
            .find(".name")
            .text(name)
            .css("background-color", color);

        if (part.tag) {
            if (configs.usersConfig.enableTags) {
                const tag = document.createElement("div");
                $(tag).addClass("nametag");
                $(tag).text(part.tag.text);
                $(tag).css("background", part.tag.color);
                part.tagDiv = $(part.nameDiv).prepend(tag);
            }

            if (part.tag.text === "ADMIN") {
                $(part.nameDiv).addClass("admin");
            }

            if (part.tag.text === "OWNER") {
                $(part.nameDiv).addClass("webmaster");
            }
        }
    });

    gClient.on("ch", msg => {
        for (const part of Object.values(gClient.ppl)) {
            if (part.id === gClient.participantId) {
                $(part.nameDiv).addClass("me");
            } else {
                $(part.nameDiv).removeClass("me");
            }

            if (msg.ch.crown && msg.ch.crown.participantId === part.id) {
                $(part.nameDiv).addClass("owner");
                $(part.cursorDiv).addClass("owner");
            } else {
                $(part.nameDiv).removeClass("owner");
                $(part.cursorDiv).removeClass("owner");
            }

            if (gPianoMutes.indexOf(part._id) !== -1) {
                $(part.nameDiv).addClass("muted-notes");
            } else {
                $(part.nameDiv).removeClass("muted-notes");
            }

            if (gChatMutes.indexOf(part._id) !== -1) {
                $(part.nameDiv).addClass("muted-chat");
            } else {
                $(part.nameDiv).removeClass("muted-chat");
            }
        }
    });

    const updateCursor = msg => {
        const part = gClient.ppl[msg.id];

        if (part && part.cursorDiv) {
            part.cursorDiv.style.left = msg.x + "%";
            part.cursorDiv.style.top = msg.y + "%";
        }
    };

    gClient.on("m", updateCursor);
    gClient.on("participant added", updateCursor);

    // Handle changes to crown
    const jqcrown = $('<div id="crown"></div>').appendTo(document.body).hide();

    const jqcountdown = $("<span></span>").appendTo(jqcrown);
    let countdown_interval;

    jqcrown.click(() => {
        gClient.sendArray([{ m: "chown", id: gClient.participantId }]);
    });

    gClient.on("ch", msg => {
        if (msg.ch.crown) {
            const crown = msg.ch.crown;
            if (!crown.participantId || !gClient.ppl[crown.participantId]) {
                const land_time = crown.time + 2000 - gClient.serverTimeOffset;
                const avail_time =
                    crown.time + 15000 - gClient.serverTimeOffset;

                jqcountdown.text("");
                jqcrown.show();

                if (land_time - Date.now() <= 0) {
                    jqcrown.css({
                        left: crown.endPos.x + "%",
                        top: crown.endPos.y + "%"
                    });
                } else {
                    jqcrown.css({
                        left: crown.startPos.x + "%",
                        top: crown.startPos.y + "%"
                    });

                    jqcrown.addClass("spin");
                    jqcrown.animate(
                        {
                            left: crown.endPos.x + "%",
                            top: crown.endPos.y + "%"
                        },
                        2000,
                        "linear",
                        () => {
                            jqcrown.removeClass("spin");
                        }
                    );
                }

                clearInterval(countdown_interval);

                countdown_interval = setInterval(() => {
                    let time = Date.now();

                    if (time >= land_time) {
                        let ms = avail_time - time;

                        if (ms > 0) {
                            jqcountdown.text(Math.ceil(ms / 1000) + "s");
                        } else {
                            jqcountdown.text("");
                            clearInterval(countdown_interval);
                        }
                    }
                }, 1000);
            } else {
                jqcrown.hide();
            }
        } else {
            jqcrown.hide();
        }
    });

    gClient.on("disconnect", () => {
        jqcrown.fadeOut(2000);
    });

    // Playing notes
    gClient.on("n", msg => {
        const t = msg.t - gClient.serverTimeOffset + TIMING_TARGET - Date.now();
        const participant = gClient.findParticipantById(msg.p);

        if (gPianoMutes.indexOf(participant._id) !== -1) return;

        for (const note of msg.n) {
            let ms = t + (note.d || 0);

            if (ms < 0) {
                ms = 0;
            } else if (ms > 10000) continue;

            if (note.s) {
                gPiano.stop(note.n, participant, ms);
            } else {
                let vel =
                    typeof note.v !== "undefined"
                        ? parseFloat(note.v)
                        : DEFAULT_VELOCITY;

                if (!vel) vel = 0;
                if (vel < 0) vel = 0;
                if (vel > 1) vel = 1;

                gPiano.play(note.n, vel, participant, ms);

                if (enableSynth) gPiano.stop(note.n, participant, ms + 1000);
            }
        }
    });

    // Send cursor updates
    let mx = 0,
        last_mx = -10,
        my = 0,
        last_my = -10;

    setInterval(() => {
        if (Math.abs(mx - last_mx) > 0.1 || Math.abs(my - last_my) > 0.1) {
            last_mx = mx;
            last_my = my;

            gClient.sendArray([{ m: "m", x: mx, y: my }]);

            if (gSeeOwnCursor) {
                gClient.emit("m", {
                    m: "m",
                    id: gClient.participantId,
                    x: mx,
                    y: my
                });
            }

            const part = gClient.getOwnParticipant();

            if (part) {
                part.x = mx;
                part.y = my;
            }
        }
    }, 50);

    $(document).mousemove(event => {
        mx = ((event.pageX / $(window).width()) * 100).toFixed(2);
        my = ((event.pageY / $(window).height()) * 100).toFixed(2);
    });

    // Room settings button
    gClient.on("ch", msg => {
        if (gClient.isOwner()) {
            $("#room-settings-btn").show();
        } else {
            $("#room-settings-btn").hide();
        }
    });

    $("#room-settings-btn").click(evt => {
        if (gClient.channel && gClient.isOwner()) {
            const settings = gClient.channel.settings;

            openModal("#room-settings");

            setTimeout(() => {
                $("#room-settings .checkbox[name=visible]").prop(
                    "checked",
                    settings.visible
                );
                $("#room-settings .checkbox[name=chat]").prop(
                    "checked",
                    settings.chat
                );
                $("#room-settings .checkbox[name=crownsolo]").prop(
                    "checked",
                    settings.crownsolo
                );
                $("#room-settings input[name=color]").val(settings.color);
            }, 100);
        }
    });

    $("#room-settings .submit").click(() => {
        const settings = {
            visible: $("#room-settings .checkbox[name=visible]").is(":checked"),
            chat: $("#room-settings .checkbox[name=chat]").is(":checked"),
            crownsolo: $("#room-settings .checkbox[name=crownsolo]").is(
                ":checked"
            ),
            color: $("#room-settings input[name=color]").val()
        };

        gClient.setChannelSettings(settings);

        closeModal();
    });

    $("#room-settings .drop-crown").click(() => {
        closeModal();
        if (confirm("This will drop the crown...!"))
            gClient.sendArray([{ m: "chown" }]);
    });

    // Handle notifications
    gClient.on("notification", msg => {
        new Notification(msg);
    });

    // Don't foget spin
    gClient.on("ch", msg => {
        const chidlo = msg.ch._id.toLowerCase();

        if (chidlo === "spin" || chidlo.substr(-5) === "/spin") {
            $("#piano").addClass("spin");
        } else {
            $("#piano").removeClass("spin");
        }
    });

    /*const eb = () => {
		if(gClient.channel && gClient.channel._id.toLowerCase() === "test/fishing") {
			ebsprite.start(gClient);
		} else {
			ebsprite.stop();
		}
	}

	if(ebsprite) {
		gClient.on("ch", eb);
		eb();
	}*/

    // Crownsolo notice
    gClient.on("ch", msg => {
        let notice = "";
        let has_notice = false;

        if (msg.ch.settings.crownsolo) {
            has_notice = true;
            notice += '<p>This room is set to "only the owner can play."</p>';
        }

        if (msg.ch.settings["no cussing"]) {
            has_notice = true;
            notice += '<p>This room is set to "no cussing."</p>';
        }

        let notice_div = $("#room-notice");

        if (has_notice) {
            notice_div.html(notice);

            if (notice_div.is(":hidden")) notice_div.fadeIn(1000);
        } else {
            if (notice_div.is(":visible")) notice_div.fadeOut(1000);
        }
    });

    gClient.on("disconnect", () => {
        $("#room-notice").fadeOut(1000);
    });

    // Background color
    let old_color1 = new Color("#000000");
    let old_color2 = new Color("#000000");

    const setColor = (hex, hex2) => {
        const color1 = new Color(hex);
        const color2 = new Color(hex2 || hex);

        if (!hex2) color2.add(-0x40, -0x40, -0x40);

        const bottom = document.getElementById("bottom");

        document.body.style.setProperty("--color", color1.toHexa());
        document.body.style.setProperty("--color2", color2.toHexa());

        bottom.style.setProperty("--color", color1.toHexa());
        bottom.style.setProperty("--color2", color2.toHexa());
    };

    const setColorToDefault = () => {
        let color = "#000000";
        let color2 = "#000000";

        try {
            color = configs.urlChannel.settings.color;
            color2 = configs.urlChannel.settings.color2;
        } catch (err) {}
        setColor(color, color2);
    };

    setColorToDefault();

    gClient.on("ch", ch => {
        if (ch.ch.settings) {
            if (ch.ch.settings.color) {
                setColor(ch.ch.settings.color, ch.ch.settings.color2);
            } else {
                setColorToDefault();
            }
        }
    });

    const gPianoMutes = (localStorage.pianoMutes ? localStorage.pianoMutes : "")
        .split(",")
        .filter(v => v);

    const gChatMutes = (localStorage.pianoMutes ? localStorage.pianoMutes : "")
        .split(",")
        .filter(v => v);

    const volume_slider = document.getElementById("volume-slider");

    volume_slider.value = gPiano.audio.volume;

    $("#volume-label").text(
        "Volume: " + Math.floor(gPiano.audio.volume * 100) + "%"
    );

    volume_slider.addEventListener("input", evt => {
        let v = +volume_slider.value;
        gPiano.audio.setVolume(v);
        if (window.localStorage) localStorage.volume = v;
        $("#volume-label").text("Volume: " + Math.floor(v * 100) + "%");
    });

    class Note {
        constructor(note, octave) {
            this.note = note;
            this.octave = octave || 0;
        }
    }

    const n = (a, b) => {
        return { note: new Note(a, b), held: false };
    };

    const key_binding = {
        65: n("gs"),
        90: n("a"),
        83: n("as"),
        88: n("b"),
        67: n("c", 1),
        70: n("cs", 1),
        86: n("d", 1),
        71: n("ds", 1),
        66: n("e", 1),
        78: n("f", 1),
        74: n("fs", 1),
        77: n("g", 1),
        75: n("gs", 1),
        188: n("a", 1),
        76: n("as", 1),
        190: n("b", 1),
        191: n("c", 2),
        222: n("cs", 2),

        49: n("gs", 1),
        81: n("a", 1),
        50: n("as", 1),
        87: n("b", 1),
        69: n("c", 2),
        52: n("cs", 2),
        82: n("d", 2),
        53: n("ds", 2),
        84: n("e", 2),
        89: n("f", 2),
        55: n("fs", 2),
        85: n("g", 2),
        56: n("gs", 2),
        73: n("a", 2),
        57: n("as", 2),
        79: n("b", 2),
        80: n("c", 3),
        189: n("cs", 3),
        173: n("cs", 3), // firefox why
        219: n("d", 3),
        187: n("ds", 3),
        61: n("ds", 3), // firefox why
        221: n("e", 3)
    };

    let capsLockKey = false;

    let transpose_octave = 0;

    const handleKeyDown = evt => {
        //console.log(evt);
        const code = parseInt(evt.keyCode);

        if (key_binding[code] !== undefined) {
            const binding = key_binding[code];

            if (!binding.held) {
                binding.held = true;

                let note = binding.note;
                let octave = 1 + note.octave + transpose_octave;

                if (evt.shiftKey) ++octave;
                else if (capsLockKey || evt.ctrlKey) --octave;

                note = note.note + octave;

                let vol = velocityFromMouseY();
                press(note, vol);
            }

            if (++gKeyboardSeq === 3) {
                gKnowsYouCanUseKeyboard = true;
                if (window.gKnowsYouCanUseKeyboardTimeout)
                    clearTimeout(gKnowsYouCanUseKeyboardTimeout);
                if (localStorage) localStorage.knowsYouCanUseKeyboard = true;
                if (window.gKnowsYouCanUseKeyboardNotification)
                    gKnowsYouCanUseKeyboardNotification.close();
            }

            evt.preventDefault();
            evt.stopPropagation();

            return false;
        } else if (code === 20) {
            // Caps Lock
            capsLockKey = true;
            evt.preventDefault();
        } else if (code === 0x20) {
            // Space Bar
            pressSustain();
            evt.preventDefault();
        } else if ((code === 38 || code === 39) && transpose_octave < 3) {
            ++transpose_octave;
        } else if ((code === 40 || code === 37) && transpose_octave > -2) {
            --transpose_octave;
        } else if (code == 9) {
            // Tab (don't tab away from the piano)
            evt.preventDefault();
        } else if (code == 8) {
            // Backspace (don't navigate Back)
            gAutoSustain = !gAutoSustain;
            evt.preventDefault();
        }
    };

    const handleKeyUp = evt => {
        const code = parseInt(evt.keyCode);

        if (key_binding[code] !== undefined) {
            const binding = key_binding[code];

            if (binding.held) {
                binding.held = false;

                let note = binding.note;
                let octave = 1 + note.octave + transpose_octave;
                if (evt.shiftKey) ++octave;
                else if (capsLockKey || evt.ctrlKey) --octave;
                note = note.note + octave;
                release(note);
            }

            evt.preventDefault();
            evt.stopPropagation();
            return false;
        } else if (code === 20) {
            // Caps Lock
            capsLockKey = false;
            evt.preventDefault();
        } else if (code === 0x20) {
            // Space Bar
            releaseSustain();
            evt.preventDefault();
        }
    };

    const handleKeyPress = evt => {
        evt.preventDefault();
        evt.stopPropagation();

        if (evt.keyCode == 27 || evt.keyCode == 13) {
            //$("#chat input").focus();
        }

        return false;
    };

    const recapListener = evt => {
        captureKeyboard();
    };

    const captureKeyboard = () => {
        $("#piano").off("mousedown", recapListener);
        $("#piano").off("touchstart", recapListener);

        $(document).on("keydown", handleKeyDown);
        $(document).on("keyup", handleKeyUp);

        $(window).on("keypress", handleKeyPress);
    };

    const releaseKeyboard = () => {
        $(document).off("keydown", handleKeyDown);
        $(document).off("keyup", handleKeyUp);

        $(window).off("keypress", handleKeyPress);

        $("#piano").on("mousedown", recapListener);
        $("#piano").on("touchstart", recapListener);
    };

    captureKeyboard();

    const velocityFromMouseY = () => {
        return 0.1 + (my / 100) * 0.6;
    };

    // NoteQuota
    const gNoteQuota = (() => {
        let last_rat = 0;
        const nqjq = $("#quota .value");

        setInterval(() => {
            gNoteQuota.tick();
        }, 2000);

        return new NoteQuota(points => {
            // update UI
            const rat = (points / this.max) * 100;

            if (rat <= last_rat)
                nqjq.stop(true, true).css("width", rat.toFixed(0) + "%");
            else
                nqjq.stop(true, true).animate(
                    { width: rat.toFixed(0) + "%" },
                    2000,
                    "linear"
                );
            last_rat = rat;
        });
    })();

    gClient.on("nq", nq_params => {
        gNoteQuota.setParams(nq_params);
    });

    gClient.on("disconnect", () => {
        gNoteQuota.setParams(NoteQuota.PARAMS_OFFLINE);
    });

    // click participant names
    const ele = document.getElementById("names");

    const touchhandler = e => {
        const target_jq = $(e.target);

        if (target_jq.hasClass("name")) {
            target_jq.addClass("play");

            if (e.target.participantId == gClient.participantId) {
                openModal("#rename", "input[name=name]");

                setTimeout(() => {
                    $("#rename input[name=name]").val(
                        gClient.ppl[gClient.participantId].name
                    );

                    $("#rename input[name=color]").val(
                        gClient.ppl[gClient.participantId].color
                    );
                }, 100);
            } else if (e.target.participantId) {
                const id = e.target.participantId;
                const part = gClient.ppl[id] || null;

                if (part) {
                    participantMenu(part);
                    e.stopPropagation();
                }
            }
        }
    };

    ele.addEventListener("mousedown", touchhandler);
    ele.addEventListener("touchstart", touchhandler);

    const releasehandler = e => {
        $("#names .name").removeClass("play");
    };

    document.body.addEventListener("mouseup", releasehandler);
    document.body.addEventListener("touchend", releasehandler);

    const removeParticipantMenus = () => {
        $(".participant-menu").remove();
        $(".participantSpotlight").hide();

        document.removeEventListener("mousedown", removeParticipantMenus);
        document.removeEventListener("touchstart", removeParticipantMenus);
    };

    const participantMenu = part => {
        if (!part) return;

        removeParticipantMenus();

        document.addEventListener("mousedown", removeParticipantMenus);
        document.addEventListener("touchstart", removeParticipantMenus);

        $("#" + part.id)
            .find(".enemySpotlight")
            .show();

        const menu = $('<div class="participant-menu"></div>');

        $("body").append(menu);

        // move menu to name position
        const jq_nd = $(part.nameDiv);
        const pos = jq_nd.position();

        menu.css({
            top: pos.top + jq_nd.height() + 15,
            left: pos.left + 6,
            background: part.color || "black"
        });

        menu.on("mousedown touchstart", evt => {
            evt.stopPropagation();

            const target = $(evt.target);

            if (target.hasClass("menu-item")) {
                target.addClass("clicked");

                menu.fadeOut(200, () => {
                    removeParticipantMenus();
                });
            }
        });

        // this spaces stuff out but also can be used for informational
        $('<div class="info"></div>').appendTo(menu).text(part._id);

        // add menu items
        if (gPianoMutes.indexOf(part._id) == -1) {
            $('<div class="menu-item">Mute Notes</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    gPianoMutes.push(part._id);

                    if (localStorage)
                        localStorage.pianoMutes = gPianoMutes.join(",");

                    $(part.nameDiv).addClass("muted-notes");
                });
        } else {
            $('<div class="menu-item">Unmute Notes</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    let i;

                    while ((i = gPianoMutes.indexOf(part._id)) != -1)
                        gPianoMutes.splice(i, 1);

                    if (localStorage)
                        localStorage.pianoMutes = gPianoMutes.join(",");

                    $(part.nameDiv).removeClass("muted-notes");
                });
        }

        if (gChatMutes.indexOf(part._id) == -1) {
            $('<div class="menu-item">Mute Chat</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    gChatMutes.push(part._id);

                    if (localStorage)
                        localStorage.chatMutes = gChatMutes.join(",");

                    $(part.nameDiv).addClass("muted-chat");
                });
        } else {
            $('<div class="menu-item">Unmute Chat</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    let i;

                    while ((i = gChatMutes.indexOf(part._id)) != -1)
                        gChatMutes.splice(i, 1);

                    if (localStorage)
                        localStorage.chatMutes = gChatMutes.join(",");

                    $(part.nameDiv).removeClass("muted-chat");
                });
        }

        if (
            !(gPianoMutes.indexOf(part._id) >= 0) ||
            !(gChatMutes.indexOf(part._id) >= 0)
        ) {
            $('<div class="menu-item">Mute Completely</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    gPianoMutes.push(part._id);

                    if (localStorage)
                        localStorage.pianoMutes = gPianoMutes.join(",");

                    gChatMutes.push(part._id);

                    if (localStorage)
                        localStorage.chatMutes = gChatMutes.join(",");

                    $(part.nameDiv).addClass("muted-notes");
                    $(part.nameDiv).addClass("muted-chat");
                });
        }

        if (
            gPianoMutes.indexOf(part._id) >= 0 ||
            gChatMutes.indexOf(part._id) >= 0
        ) {
            $('<div class="menu-item">Unmute Completely</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    let i;

                    while ((i = gPianoMutes.indexOf(part._id)) != -1)
                        gPianoMutes.splice(i, 1);

                    while ((i = gChatMutes.indexOf(part._id)) != -1)
                        gChatMutes.splice(i, 1);

                    if (localStorage)
                        localStorage.pianoMutes = gPianoMutes.join(",");
                    if (localStorage)
                        localStorage.chatMutes = gChatMutes.join(",");

                    $(part.nameDiv).removeClass("muted-notes");
                    $(part.nameDiv).removeClass("muted-chat");
                });
        }

        if (gClient.isOwner()) {
            $('<div class="menu-item give-crown">Give Crown</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    if (confirm("Give room ownership to " + part.name + "?"))
                        gClient.sendArray([{ m: "chown", id: part.id }]);
                });

            $('<div class="menu-item kickban">Kickban</div>')
                .appendTo(menu)
                .on("mousedown touchstart", evt => {
                    let minutes = prompt("How many minutes? (0-60)", "30");

                    if (minutes === null) return;
                    minutes = parseFloat(minutes) || 0;

                    let ms = minutes * 60 * 1000;

                    gClient.sendArray([
                        { m: "kickban", _id: part._id, ms: ms }
                    ]);
                });
        }

        menu.fadeIn(100);
    };

    // Notification class

    ////////////////////////////////////////////////////////////////

    class Notification extends EventEmitter {
        constructor(par) {
            super();

            if (this instanceof Notification === false) throw "yeet";
            //EventEmitter.call(this);

            par = par || {};

            this.id = "Notification-" + (par.id || Math.random());
            this.title = par.title || "";
            this.text = par.text || "";
            this.html = par.html || "";
            this.target = $(par.target || "#piano");
            this.duration = par.duration || 30000;
            this["class"] = par["class"] || "classic";

            const eles = $("#" + this.id);

            if (eles.length > 0) {
                eles.remove();
            }

            this.domElement = $(
                '<div class="notification" style="display: none;"><div class="notification-body"><div class="title"></div>' +
                    '<div class="text"></div></div><div class="x">Ⓧ</div></div>'
            );

            this.domElement[0].id = this.id;
            this.domElement.addClass(this["class"]);
            this.domElement.find(".title").text(this.title);

            if (this.text.length > 0) {
                this.domElement.find(".text").text(this.text);
            } else if (this.html instanceof HTMLElement) {
                this.domElement.find(".text")[0].appendChild(this.html);
            } else if (this.html.length > 0) {
                this.domElement.find(".text").html(this.html);
            }

            document.body.appendChild(this.domElement.get(0));

            this.position();

            this.onresize = () => {
                this.position();
            };

            window.addEventListener("resize", this.onresize);

            this.domElement.find(".x").click(() => {
                this.close();
            });

            $(this.domElement).fadeIn(100);

            if (this.duration > 0) {
                setTimeout(() => {
                    this.close();
                }, this.duration);
            }

            return this;
        }

        /**
         * Reset this notification's position based on offset
         */
        position() {
            const pos = this.target.offset();

            let x =
                pos.left -
                this.domElement.width() / 2 +
                this.target.width() / 4;

            const y = pos.top - this.domElement.height() - 8;
            const width = this.domElement.width();

            if (x + width > $("body").width()) {
                x -= x + width - $("body").width();
            }

            if (x < 0) x = 0;

            this.domElement.offset({ left: x, top: y });
        }

        /**
         * Close this notification
         */
        close() {
            window.removeEventListener("resize", this.onresize);

            this.domElement.fadeOut(250, () => {
                this.domElement.remove();
                this.emit("close");
            });
        }
    }

    // set variables from settings or set settings

    ////////////////////////////////////////////////////////////////

    let gKeyboardSeq = 0;
    let gKnowsYouCanUseKeyboard = false;

    if (localStorage && localStorage.knowsYouCanUseKeyboard)
        gKnowsYouCanUseKeyboard = true;

    if (!gKnowsYouCanUseKeyboard) {
        window.gKnowsYouCanUseKeyboardTimeout = setTimeout(() => {
            window.gKnowsYouCanUseKeyboardNotification = new Notification({
                title: "Did you know!?!",
                text: "You can play the piano with your keyboard, too.  Try it!",
                target: "#piano",
                duration: 10000
            });
        }, 30000);
    }

    if (window.localStorage) {
        if (localStorage.volume) {
            volume_slider.value = localStorage.volume;
            gPiano.audio.setVolume(localStorage.volume);

            $("#volume-label").text(
                "Volume: " + Math.floor(gPiano.audio.volume * 100) + "%"
            );
        } else localStorage.volume = gPiano.audio.volume;

        window.gHasBeenHereBefore = localStorage.gHasBeenHereBefore || false;

        if (gHasBeenHereBefore) {
        }
        localStorage.gHasBeenHereBefore = true;
    }

    // warn user about loud noises before starting sound (no autoplay)
    //openModal("#sound-warning");
    // moved

    const user_interact = evt => {
        document.removeEventListener("click", user_interact);

        closeModal();

        MPP.piano.audio.resume();
    };

    document.addEventListener("click", user_interact);

    // New room, change room

    ////////////////////////////////////////////////////////////////

    $("#room > .info").text("--");

    gClient.on("ch", msg => {
        const channel = msg.ch;
        const info = $("#room > .info");

        info.text(channel._id);

        if (channel.settings.lobby) info.addClass("lobby");
        else info.removeClass("lobby");

        if (!channel.settings.chat) info.addClass("no-chat");
        else info.removeClass("no-chat");

        if (channel.settings.crownsolo) info.addClass("crownsolo");
        else info.removeClass("crownsolo");

        if (channel.settings["no cussing"]) info.addClass("no-cussing");
        else info.removeClass("no-cussing");

        if (!channel.settings.visible) info.addClass("not-visible");
        else info.removeClass("not-visible");
    });

    gClient.on("ls", ls => {
        for (const room of ls.u) {
            let info = $(
                '#room .info[roomname="' +
                    (room._id + "")
                        .replace(/[\\"']/g, "\\$&")
                        .replace(/\u0000/g, "\\0") +
                    '"]'
            );

            if (info.length == 0) {
                info = $('<div class="info"></div>');
                info.attr("roomname", room._id);
                $("#room .more").append(info);
            }

            info.text(room._id + " (" + room.count + ")");

            if (room.settings.lobby) info.addClass("lobby");
            else info.removeClass("lobby");

            if (!room.settings.chat) info.addClass("no-chat");
            else info.removeClass("no-chat");

            if (room.settings.crownsolo) info.addClass("crownsolo");
            else info.removeClass("crownsolo");

            if (room.settings["no cussing"]) info.addClass("no-cussing");
            else info.removeClass("no-cussing");

            if (!room.settings.visible) info.addClass("not-visible");
            else info.removeClass("not-visible");

            if (room.banned) info.addClass("banned");
            else info.removeClass("banned");
        }
    });

    $("#room").on("click", evt => {
        evt.stopPropagation();

        // clicks on a new room
        if (
            $(evt.target).hasClass("info") &&
            $(evt.target).parents(".more").length
        ) {
            $("#room .more").fadeOut(250);

            const selected_name = $(evt.target).attr("roomname");

            if (typeof selected_name != "undefined") {
                changeRoom(selected_name, "right");
            }

            return false;
        }
        // clicks on "New Room..."
        else if ($(evt.target).hasClass("new")) {
            openModal("#new-room", "input[name=name]");
        }

        // all other clicks
        const doc_click = evt => {
            if ($(evt.target).is("#room .more")) return;

            $(document).off("mousedown", doc_click);
            $("#room .more").fadeOut(250);

            gClient.sendArray([{ m: "-ls" }]);
        };

        $(document).on("mousedown", doc_click);

        $("#room .more .info").remove();
        $("#room .more").show();

        gClient.sendArray([{ m: "+ls" }]);
    });

    $("#new-room-btn").on("click", evt => {
        evt.stopPropagation();

        openModal("#new-room", "input[name=name]");
    });

    $("#play-alone-btn").on("click", evt => {
        evt.stopPropagation();

        const room_name = "Room" + Math.floor(Math.random() * 1000000000000);
        changeRoom(room_name, "right", { visible: false });

        setTimeout(() => {
            let html =
                "You are playing alone in a room by yourself, but you can always invite \
				friends by sending them the link.";

            if (configs.config.playingAloneSocialLinks) {
                html +=
                    "\n<a href=\"#\" onclick=\"window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'facebook-share-dialog','width=626,height=436');return false;\">Share on Facebook</a><br/><br/>\
				<a href=\"http://twitter.com/home?status=" +
                    encodeURIComponent(location.href) +
                    '" target="_blank">Tweet</a>';
            }

            new Notification({
                id: "share",
                title: "Playing alone",
                html,
                duration: 25000
            });
        }, 1000);
    });

    let gModal;

    const modalHandleEsc = evt => {
        if (evt.keyCode == 27) {
            closeModal();

            evt.preventDefault();
            evt.stopPropagation();
        }
    };

    const openModal = (selector, focus) => {
        try {
            if (chat) chat.blur();
        } catch (err) {}

        releaseKeyboard();

        $(document).on("keydown", modalHandleEsc);

        $("#modal #modals > *").hide();
        $("#modal").fadeIn(250);

        $(selector).show();

        setTimeout(() => {
            $(selector).find(focus).focus();
        }, 100);

        gModal = selector;
    };

    const closeModal = () => {
        $(document).off("keydown", modalHandleEsc);

        $("#modal").fadeOut(300);
        // $("#modal #modals > *").hide();
        captureKeyboard();

        gModal = null;
    };

    const modal_bg = $("#modal .bg")[0];

    $(modal_bg).on("click", evt => {
        if (evt.target != modal_bg) return;
        closeModal();
    });

    const submit = () => {
        let name = $("#new-room .text[name=name]").val();

        const settings = {
            visible: $("#new-room .checkbox[name=visible]").is(":checked"),
            chat: true
        };

        $("#new-room .text[name=name]").val("");

        closeModal();
        changeRoom(name, "right", settings);

        setTimeout(() => {
            let html =
                "You can invite friends to your room by sending them the link.";

            if (configs.config.createdRoomSocialLinks) {
                html +=
                    "\n<a href=\"#\" onclick=\"window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'facebook-share-dialog','width=626,height=436');return false;\">Share on Facebook</a><br/><br/>\
                <a href=\"http://twitter.com/home?status=" +
                    encodeURIComponent(location.href) +
                    '" target="_blank">Tweet</a>';
            }

            new Notification({
                id: "share",
                title: "Created a Room",
                html,
                duration: 25000
            });
        }, 1000);
    };

    // warn user about loud noises before starting sound (no autoplay)
    openModal("#sound-warning");

    $("#new-room .submit").click(evt => {
        submit();
    });

    $("#new-room .text[name=name]").keypress(evt => {
        if (evt.keyCode == 13) {
            submit();
        } else if (evt.keyCode == 27) {
            closeModal();
        } else {
            return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        return false;
    });

    const changeRoom = (name, direction, settings, push) => {
        if (!settings) settings = {};
        if (!direction) direction = "right";
        if (typeof push == "undefined") push = true;

        let opposite = direction == "left" ? "right" : "left";

        if (name == "") name = "lobby";
        if (gClient.channel && gClient.channel._id === name) return;

        if (push) {
            let url = "/" + encodeURIComponent(name).replace("'", "%27");

            if (window.history && history.pushState) {
                history.pushState(
                    { depth: (gHistoryDepth += 1), name: name },
                    "Piano > " + name,
                    url
                );
            } else {
                window.location = url;
                return;
            }
        }

        gClient.setChannel(name, settings);

        let t = 0,
            d = 100;

        if (configs.config.enableSlide) {
            $("#piano").addClass("slide");

            requestAnimationFrame(() => {
                $("#piano")
                    .addClass("ease-out")
                    .addClass("slide-" + opposite);

                setTimeout(() => {
                    $("#piano")
                        .removeClass("ease-out")
                        .removeClass("slide-" + opposite)
                        .addClass("slide-" + direction);
                }, (t += d));

                setTimeout(() => {
                    $("#piano")
                        .addClass("ease-in")
                        .removeClass("slide-" + direction);
                }, (t += d));

                setTimeout(() => {
                    $("#piano").removeClass("ease-in");

                    setTimeout(() => {
                        $("#piano").removeClass("slide");
                    }, d);
                }, (t += d));
            });
        }
    };

    let gHistoryDepth = 0;

    $(window).on("popstate", evt => {
        const depth = evt.state ? evt.state.depth : 0;
        if (depth == gHistoryDepth) return; // <-- forgot why I did that though...

        const direction = depth <= gHistoryDepth ? "left" : "right";
        gHistoryDepth = depth;

        const name = decodeURIComponent(window.location.pathname);
        if (name.substring(0, 1) == "/") name = name.substring(1);

        changeRoom(name, direction, null, false);
    });

    // Rename

    ////////////////////////////////////////////////////////////////

    const renameSubmit = () => {
        const set = {
            name: $("#rename input[name=name]").val(),
            color: $("#rename input[name=color]").val()
        };

        //$("#rename .text[name=name]").val("");

        closeModal();

        gClient.sendArray([{ m: "userset", set: set }]);
    };

    $("#rename .submit").click(evt => {
        renameSubmit();
    });

    $("#rename .text[name=name]").keypress(evt => {
        if (evt.keyCode == 13) {
            renameSubmit();
        } else if (evt.keyCode == 27) {
            closeModal();
        } else {
            return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        return false;
    });

    // chatctor

    ////////////////////////////////////////////////////////////////

    let gShouldFadeOutChatOnNextBlur = true;

    const chat = (() => {
        gClient.on("ch", msg => {
            if (msg.ch.settings.chat) {
                chat.show();
            } else {
                chat.hide();
            }
        });

        gClient.on("disconnect", msg => {
            if (configs.config.hideChatOnDisconnect) chat.hide();
        });

        gClient.on("c", msg => {
            chat.clear();
            if (msg.c) {
                for (let i = 0; i < msg.c.length; i++) {
                    chat.receive(msg.c[i]);
                }
            }
        });

        gClient.on("a", msg => {
            chat.receive(msg);
        });

        $("#chat input").on("focus", evt => {
            releaseKeyboard();

            $("#chat").addClass("chatting");

            chat.scrollToBottom();
            chat.fadeIn();
        });

        /*$("#chat input").on("blur", evt => {
			captureKeyboard();

			$("#chat").removeClass("chatting");

			chat.scrollToBottom();
		});*/

        $(document).mousedown(evt => {
            if (!$("#chat").has(evt.target).length > 0) {
                chat.blur();
            }
        });

        document.addEventListener("touchstart", event => {
            for (const touch of event.changedTouches) {
                if (!$("#chat").has(touch.target).length > 0) {
                    chat.blur();
                }
            }
        });

        $(document).on("keydown", evt => {
            if ($("#chat").hasClass("chatting")) {
                if (evt.keyCode == 27) {
                    chat.blur();

                    evt.preventDefault();
                    evt.stopPropagation();
                } else if (evt.keyCode == 13) {
                    $("#chat input").focus();
                }
            } else if (!gModal && (evt.keyCode == 27 || evt.keyCode == 13)) {
                $("#chat input").focus();
            }
        });

        $("#chat input").on("keydown", evt => {
            if (evt.keyCode == 13) {
                if (MPP.client.isConnected()) {
                    let message = $("#chat input").val();

                    if (message.length == 0) {
                        setTimeout(() => {
                            chat.blur();
                        }, 100);
                    } else if (message.length <= 512) {
                        chat.send(message);

                        $("#chat input").val("");

                        setTimeout(() => {
                            chat.blur();
                        }, 100);
                    }
                }

                evt.preventDefault();
                evt.stopPropagation();
            } else if (evt.keyCode == 27) {
                chat.blur();

                evt.preventDefault();
                evt.stopPropagation();
            } else if (evt.keyCode == 9) {
                evt.preventDefault();
                evt.stopPropagation();
            }
        });

        return {
            show: () => {
                $("#chat").fadeIn();
            },

            hide: () => {
                $("#chat").fadeOut();
            },

            clear: () => {
                $("#chat li").remove();
            },

            scrollToBottom: () => {
                const ele = $("#chat ul").get(0);
                ele.scrollTop = ele.scrollHeight - ele.clientHeight;
            },

            blur: () => {
                if ($("#chat").hasClass("chatting")) {
                    $("#chat input").get(0).blur();
                    $("#chat").removeClass("chatting");

                    chat.scrollToBottom();

                    captureKeyboard();

                    gShouldFadeOutChatOnNextBlur = true;

                    setTimeout(() => {
                        if (gShouldFadeOutChatOnNextBlur === true)
                            chat.fadeOut();
                    }, 90000);
                }
            },

            send: message => {
                gClient.sendArray([{ m: "a", message: message }]);
            },

            receive: msg => {
                if (gChatMutes.indexOf(msg.p._id) != -1) return;

                const li = $('<li><span class="name"/><span class="message"/>');

                li.find(".name").text(msg.p.name + ":");
                li.find(".message").text(msg.a);
                li.css("color", msg.p.color || "white");

                $("#chat ul").append(li);

                const eles = $("#chat ul li").get();

                for (let i = 1; i <= 50 && i <= eles.length; i++) {
                    eles[eles.length - i].style.opacity = 1.0 - i * 0.03;
                }

                if (eles.length > 50) {
                    eles[0].style.display = "none";
                }

                if (eles.length > 256) {
                    $(eles[0]).remove();
                }

                // scroll to bottom if not "chatting" or if not scrolled up
                if (!$("#chat").hasClass("chatting")) {
                    chat.scrollToBottom();
                } else {
                    const ele = $("#chat ul").get(0);

                    if (
                        ele.scrollTop >
                        ele.scrollHeight - ele.offsetHeight - 50
                    )
                        chat.scrollToBottom();
                }

                gShouldFadeOutChatOnNextBlur = false;
                chat.fadeIn();
            },

            fadeIn: (d = 100) => {
                if (configs.config.fadeChat) {
                    $("#chat ul").fadeTo(d, 1);
                }
            },

            fadeOut: (d = 750) => {
                if (configs.config.fadeChat) {
                    $("#chat ul").fadeTo(1000, 0.2);
                }
            }
        };
    })();

    // MIDI

    ////////////////////////////////////////////////////////////////

    let MIDI_TRANSPOSE = -12;
    let MIDI_KEY_NAMES = ["a-1", "as-1", "b-1"];
    const bare_notes = "c cs d ds e f fs g gs a as b".split(" ");

    for (let oct = 0; oct < 7; oct++) {
        for (const bare_note of bare_notes) {
            MIDI_KEY_NAMES.push(bare_note + oct);
        }
    }

    MIDI_KEY_NAMES.push("c7");

    let devices_json = "[]";

    const sendDevices = () => {
        gClient.sendArray([{ m: "devices", list: JSON.parse(devices_json) }]);
    };

    gClient.on("connect", sendDevices);

    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(
            midi => {
                // console.log(midi);
                const midimessagehandler = evt => {
                    if (!evt.target.enabled) return;
                    //console.log(evt);
                    const channel = evt.data[0] & 0xf;
                    const cmd = evt.data[0] >> 4;
                    const note_number = evt.data[1];
                    let vel = evt.data[2];

                    //console.log(channel, cmd, note_number, vel);
                    if (cmd == 8 || (cmd == 9 && vel == 0)) {
                        // NOTE_OFF
                        release(
                            MIDI_KEY_NAMES[note_number - 9 + MIDI_TRANSPOSE]
                        );
                    } else if (cmd == 9) {
                        // NOTE_ON
                        if (evt.target.volume !== undefined)
                            vel *= evt.target.volume;
                        press(
                            MIDI_KEY_NAMES[note_number - 9 + MIDI_TRANSPOSE],
                            vel / 100
                        );
                    } else if (cmd == 11) {
                        // CONTROL_CHANGE
                        if (!gAutoSustain) {
                            if (note_number == 64) {
                                if (vel > 0) {
                                    pressSustain();
                                } else {
                                    releaseSustain();
                                }
                            }
                        }
                    }
                };

                const deviceInfo = dev => {
                    return {
                        type: dev.type,
                        //id: dev.id,
                        manufacturer: dev.manufacturer,
                        name: dev.name,
                        version: dev.version,
                        //connection: dev.connection,
                        //state: dev.state,
                        enabled: dev.enabled,
                        volume: dev.volume
                    };
                };

                const updateDevices = () => {
                    const list = [];

                    if (midi.inputs.size > 0) {
                        const inputs = midi.inputs.values();

                        for (
                            let input_it = inputs.next();
                            input_it && !input_it.done;
                            input_it = inputs.next()
                        ) {
                            const input = input_it.value;
                            list.push(deviceInfo(input));
                        }
                    }

                    if (midi.outputs.size > 0) {
                        let outputs = midi.outputs.values();

                        for (
                            let output_it = outputs.next();
                            output_it && !output_it.done;
                            output_it = outputs.next()
                        ) {
                            let output = output_it.value;

                            list.push(deviceInfo(output));
                        }
                    }

                    const new_json = JSON.stringify(list);

                    if (new_json !== devices_json) {
                        devices_json = new_json;
                        sendDevices();
                    }
                };

                let connectionsNotification;

                const showConnections = sticky => {
                    //if(document.getElementById("Notification-MIDI-Connections"))
                    //sticky = 1; // todo: instead,
                    const inputs_ul = document.createElement("ul");

                    if (midi.inputs.size > 0) {
                        let inputs = midi.inputs.values();

                        for (
                            let input_it = inputs.next();
                            input_it && !input_it.done;
                            input_it = inputs.next()
                        ) {
                            const input = input_it.value;
                            const li = document.createElement("li");

                            li.connectionId = input.id;
                            li.classList.add("connection");

                            if (input.enabled) li.classList.add("enabled");
                            li.textContent = input.name;

                            li.addEventListener("click", evt => {
                                const inputs = midi.inputs.values();

                                for (
                                    let input_it = inputs.next();
                                    input_it && !input_it.done;
                                    input_it = inputs.next()
                                ) {
                                    const input = input_it.value;

                                    if (input.id === evt.target.connectionId) {
                                        input.enabled = !input.enabled;
                                        evt.target.classList.toggle("enabled");

                                        // console.log("click", input);

                                        updateDevices();

                                        return;
                                    }
                                }
                            });

                            if (gMidiVolumeTest) {
                                const knob = document.createElement("canvas");

                                mixin(knob, {
                                    width: 16 * window.devicePixelRatio,
                                    height: 16 * window.devicePixelRatio,
                                    className: "knob"
                                });

                                li.appendChild(knob);

                                knob = new Knob(
                                    knob,
                                    0,
                                    2,
                                    0.01,
                                    input.volume,
                                    "volume"
                                );

                                knob.canvas.style.width = "16px";
                                knob.canvas.style.height = "16px";
                                knob.canvas.style.float = "right";

                                knob.on("change", k => {
                                    input.volume = k.value;
                                });

                                knob.emit("change", knob);
                            }

                            inputs_ul.appendChild(li);
                        }
                    } else {
                        inputs_ul.textContent = "(none)";
                    }

                    const outputs_ul = document.createElement("ul");

                    if (midi.outputs.size > 0) {
                        const outputs = midi.outputs.values();

                        for (
                            let output_it = outputs.next();
                            output_it && !output_it.done;
                            output_it = outputs.next()
                        ) {
                            const output = output_it.value;
                            const li = document.createElement("li");

                            li.connectionId = output.id;
                            li.classList.add("connection");

                            if (output.enabled) li.classList.add("enabled");

                            li.textContent = output.name;

                            li.addEventListener("click", evt => {
                                const outputs = midi.outputs.values();

                                for (
                                    let output_it = outputs.next();
                                    output_it && !output_it.done;
                                    output_it = outputs.next()
                                ) {
                                    const output = output_it.value;

                                    if (output.id === evt.target.connectionId) {
                                        output.enabled = !output.enabled;
                                        evt.target.classList.toggle("enabled");
                                        // console.log("click", output);
                                        updateDevices();
                                        return;
                                    }
                                }
                            });

                            if (gMidiVolumeTest) {
                                const knob = document.createElement("canvas");

                                mixin(knob, {
                                    width: 16 * window.devicePixelRatio,
                                    height: 16 * window.devicePixelRatio,
                                    className: "knob"
                                });

                                li.appendChild(knob);

                                knob = new Knob(
                                    knob,
                                    0,
                                    2,
                                    0.01,
                                    output.volume,
                                    "volume"
                                );

                                knob.canvas.style.width = "16px";
                                knob.canvas.style.height = "16px";
                                knob.canvas.style.float = "right";

                                knob.on("change", k => {
                                    output.volume = k.value;
                                });

                                knob.emit("change", knob);
                            }

                            outputs_ul.appendChild(li);
                        }
                    } else {
                        outputs_ul.textContent = "(none)";
                    }

                    let div = document.createElement("div");
                    let h1 = document.createElement("h1");

                    h1.textContent = "Inputs";

                    div.appendChild(h1);
                    div.appendChild(inputs_ul);

                    h1 = document.createElement("h1");
                    h1.textContent = "Outputs";

                    div.appendChild(h1);
                    div.appendChild(outputs_ul);

                    connectionsNotification = new Notification({
                        id: "MIDI-Connections",
                        title: "MIDI Connections",
                        duration: sticky ? "-1" : "4500",
                        html: div,
                        target: "#midi-btn"
                    });
                };

                const plug = () => {
                    if (midi.inputs.size > 0) {
                        const inputs = midi.inputs.values();

                        for (
                            let input_it = inputs.next();
                            input_it && !input_it.done;
                            input_it = inputs.next()
                        ) {
                            const input = input_it.value;

                            //input.removeEventListener("midimessage", midimessagehandler);
                            //input.addEventListener("midimessage", midimessagehandler);

                            input.onmidimessage = midimessagehandler;

                            if (input.enabled !== false) {
                                input.enabled = true;
                            }

                            if (typeof input.volume === "undefined") {
                                input.volume = 1.0;
                            }

                            // console.log("input", input);
                        }
                    }

                    if (midi.outputs.size > 0) {
                        const outputs = midi.outputs.values();

                        for (
                            let output_it = outputs.next();
                            output_it && !output_it.done;
                            output_it = outputs.next()
                        ) {
                            const output = output_it.value;

                            //output.enabled = false; // edit: don't touch

                            if (typeof output.volume === "undefined") {
                                output.volume = 1.0;
                            }

                            // console.log("output", output);
                        }

                        gMidiOutTest = (note_name, vel, delay_ms) => {
                            let note_number = MIDI_KEY_NAMES.indexOf(note_name);

                            if (note_number == -1) return;

                            note_number = note_number + 9 - MIDI_TRANSPOSE;

                            const outputs = midi.outputs.values();

                            for (
                                let output_it = outputs.next();
                                output_it && !output_it.done;
                                output_it = outputs.next()
                            ) {
                                const output = output_it.value;

                                if (output.enabled) {
                                    let v = vel;

                                    if (output.volume !== undefined)
                                        v *= output.volume;

                                    output.send(
                                        [0x90, note_number, v],
                                        window.performance.now() + delay_ms
                                    );
                                }
                            }
                        };
                    }
                    showConnections(false);
                    updateDevices();
                };

                midi.addEventListener("statechange", evt => {
                    if (evt instanceof MIDIConnectionEvent) {
                        plug();
                    }
                });

                plug();

                document
                    .getElementById("midi-btn")
                    .addEventListener("click", evt => {
                        if (
                            !document.getElementById(
                                "Notification-MIDI-Connections"
                            )
                        )
                            showConnections(true);
                        else {
                            connectionsNotification.close();
                        }
                    });
            },
            err => {
                console.log(err);
            }
        );
    }

    // more button
    let loaded = false;

    setTimeout(() => {
        $("#social").fadeIn(250);
        $("#more-button").click(() => {
            openModal("#more");

            if (loaded === false) {
                $.get("/more.html").success(data => {
                    loaded = true;

                    const items = $(data).find(".item");

                    if (items.length > 0) {
                        $("#more .items").append(items);
                    }

                    try {
                        const ele = document.getElementById("email");
                        const email = ele
                            .getAttribute("obscured")
                            .replace(/[a-zA-Z]/g, c => {
                                return String.fromCharCode(
                                    (c <= "Z" ? 90 : 122) >=
                                        (c = c.charCodeAt(0) + 13)
                                        ? c
                                        : c - 26
                                );
                            });

                        ele.href = "mailto:" + email;
                        ele.textContent = email;
                    } catch (e) {}
                });
            }
        });
    }, 5000);

    // API
    window.MPP = {
        press: press,
        release: release,
        pressSustain: pressSustain,
        releaseSustain: releaseSustain,
        piano: gPiano,
        client: gClient,
        chat: chat,
        noteQuota: gNoteQuota,
        soundSelector: gSoundSelector,
        Notification: Notification,
        configs
    };

    // record mp3
    (() => {
        let mp3button = document.querySelector("#record-btn");
        let mp3audio = MPP.piano.audio;
        let mp3context = mp3audio.context;
        // let mp3encoder_sample_rate = 44100;
        let mp3encoder_sample_rate = 48000;
        let mp3encoder_kbps = 128;
        let mp3encoder = null;
        let mp3scriptProcessorNode = mp3context.createScriptProcessor(
            4096,
            2,
            2
        );
        let mp3recording = false;
        let mp3recording_start_time = 0;
        let mp3_buffer = [];

        mp3button.addEventListener("click", evt => {
            if (!mp3recording) {
                // start recording
                mp3_buffer = [];
                mp3encoder = new lamejs.Mp3Encoder(
                    2,
                    mp3encoder_sample_rate,
                    mp3encoder_kbps
                );

                mp3scriptProcessorNode.onaudioprocess = onAudioProcess;
                mp3audio.masterGain.connect(mp3scriptProcessorNode);
                mp3scriptProcessorNode.connect(mp3context.destination);

                mp3recording_start_time = Date.now();
                mp3recording = true;

                mp3button.textContent = "Stop Recording";
                mp3button.classList.add("stuck");

                new Notification({
                    id: "mp3",
                    title: "Recording MP3...",
                    html: 'It\'s recording now.  This could make things slow, maybe.  Maybe give it a moment to settle before playing.<br><br>This feature is experimental.<br>Send complaints to <a href="mailto:multiplayerpiano.com@gmail.com">multiplayerpiano.com@gmail.com</a>.',
                    duration: 10000
                });
            } else {
                // stop recording
                const mp3buf = mp3encoder.flush();

                mp3_buffer.push(mp3buf);

                const blob = new Blob(mp3_buffer, { type: "audio/mp3" });
                const url = URL.createObjectURL(blob);

                mp3scriptProcessorNode.onaudioprocess = null;
                mp3audio.masterGain.disconnect(mp3scriptProcessorNode);
                mp3scriptProcessorNode.disconnect(mp3context.destination);

                mp3recording = false;

                mp3button.textContent = "Record MP3";
                mp3button.classList.remove("stuck");

                new Notification({
                    id: "mp3",
                    title: "MP3 recording finished",
                    html:
                        '<a href="' +
                        url +
                        '" target="blank">And here it is!</a> (open or save as)<br><br>This feature is experimental.<br>Send complaints to <a href="mailto:multiplayerpiano.com@gmail.com">multiplayerpiano.com@gmail.com</a>.',
                    duration: 0
                });
            }
        });

        const onAudioProcess = evt => {
            const inputL = evt.inputBuffer.getChannelData(0);
            const inputR = evt.inputBuffer.getChannelData(1);

            const mp3buf = mp3encoder.encodeBuffer(
                convert16(inputL),
                convert16(inputR)
            );

            mp3_buffer.push(mp3buf);
        };

        const convert16 = samples => {
            const len = samples.length;
            const result = new Int16Array(len);

            for (let i = 0; i < len; i++) {
                result[i] = 0x8000 * samples[i];
            }

            return result;
        };
    })();

    // synth
    let enableSynth = false;
    let audio = gPiano.audio;
    let context = gPiano.audio.context;
    let synth_gain = context.createGain();
    synth_gain.gain.value = 0.05;
    synth_gain.connect(audio.synthGain);

    let osc_types = ["sine", "square", "sawtooth", "triangle"];
    let osc_type_index = 1;

    let osc1_type = "square";
    let osc1_attack = 0;
    let osc1_decay = 0.2;
    let osc1_sustain = 0.5;
    let osc1_release = 2.0;

    class synthVoice {
        constructor(note_name, time) {
            let note_number = MIDI_KEY_NAMES.indexOf(note_name);
            note_number = note_number + 9 - MIDI_TRANSPOSE;
            const freq = Math.pow(2, (note_number - 69) / 12) * 440.0;

            this.osc = context.createOscillator();
            this.osc.type = osc1_type;
            this.osc.frequency.value = freq;

            this.gain = context.createGain();
            this.gain.gain.value = 0;

            this.osc.connect(this.gain);

            this.gain.connect(synth_gain);

            this.osc.start(time);

            this.gain.gain.setValueAtTime(0, time);
            this.gain.gain.linearRampToValueAtTime(1, time + osc1_attack);

            this.gain.gain.linearRampToValueAtTime(
                osc1_sustain,
                time + osc1_attack + osc1_decay
            );
        }

        stop(time) {
            //this.gain.gain.setValueAtTime(osc1_sustain, time);
            this.gain.gain.linearRampToValueAtTime(0, time + osc1_release);
            this.osc.stop(time + osc1_release);
        }
    }

    let synthButton = document.getElementById("synth-btn");
    let synthNotification;

    synthButton.addEventListener("click", () => {
        if (synthNotification) {
            synthNotification.close();
        } else {
            showSynth();
        }
    });

    const showSynth = () => {
        const html = document.createElement("div");

        // on/off button
        (() => {
            const button = document.createElement("input");

            mixin(button, {
                type: "button",
                value: "ON/OFF",
                className: enableSynth ? "switched-on" : "switched-off"
            });

            button.addEventListener("click", evt => {
                enableSynth = !enableSynth;
                button.className = enableSynth ? "switched-on" : "switched-off";

                if (!enableSynth) {
                    // stop all
                    for (const playing of Object.values(audio.playings)) {
                        if (playing && playing.voice) {
                            playing.voice.osc.stop();
                            playing.voice = undefined;
                        }
                    }
                }
            });

            html.appendChild(button);
        })();

        // mix
        let knob = document.createElement("canvas");

        mixin(knob, {
            width: 32 * window.devicePixelRatio,
            height: 32 * window.devicePixelRatio,
            className: "knob"
        });

        html.appendChild(knob);

        knob = new Knob(knob, 0, 100, 0.1, 50, "mix", "%");

        knob.canvas.style.width = "32px";
        knob.canvas.style.height = "32px";

        knob.on("change", k => {
            const mix = k.value / 100;

            audio.pianoGain.gain.value = 1 - mix;
            audio.synthGain.gain.value = mix;
        });

        knob.emit("change", knob);

        // osc1 type
        (() => {
            osc1_type = osc_types[osc_type_index];
            const button = document.createElement("input");

            mixin(button, {
                type: "button",
                value: osc_types[osc_type_index]
            });

            button.addEventListener("click", evt => {
                if (++osc_type_index >= osc_types.length) osc_type_index = 0;
                osc1_type = osc_types[osc_type_index];
                button.value = osc1_type;
            });

            html.appendChild(button);
        })();

        // osc1 attack
        knob = document.createElement("canvas");

        mixin(knob, {
            width: 32 * window.devicePixelRatio,
            height: 32 * window.devicePixelRatio,
            className: "knob"
        });

        html.appendChild(knob);

        knob = new Knob(knob, 0, 1, 0.001, osc1_attack, "osc1 attack", "s");

        knob.canvas.style.width = "32px";
        knob.canvas.style.height = "32px";

        knob.on("change", k => {
            osc1_attack = k.value;
        });

        knob.emit("change", knob);

        // osc1 decay
        knob = document.createElement("canvas");
        mixin(knob, {
            width: 32 * window.devicePixelRatio,
            height: 32 * window.devicePixelRatio,
            className: "knob"
        });

        html.appendChild(knob);

        knob = new Knob(knob, 0, 2, 0.001, osc1_decay, "osc1 decay", "s");

        knob.canvas.style.width = "32px";
        knob.canvas.style.height = "32px";

        knob.on("change", k => {
            osc1_decay = k.value;
        });
        knob.emit("change", knob);

        knob = document.createElement("canvas");

        mixin(knob, {
            width: 32 * window.devicePixelRatio,
            height: 32 * window.devicePixelRatio,
            className: "knob"
        });

        html.appendChild(knob);

        knob = new Knob(knob, 0, 1, 0.001, osc1_sustain, "osc1 sustain", "x");

        knob.canvas.style.width = "32px";
        knob.canvas.style.height = "32px";

        knob.on("change", k => {
            osc1_sustain = k.value;
        });

        knob.emit("change", knob);

        // osc1 release
        knob = document.createElement("canvas");

        mixin(knob, {
            width: 32 * window.devicePixelRatio,
            height: 32 * window.devicePixelRatio,
            className: "knob"
        });

        html.appendChild(knob);

        knob = new Knob(knob, 0, 2, 0.001, osc1_release, "osc1 release", "s");

        knob.canvas.style.width = "32px";
        knob.canvas.style.height = "32px";

        knob.on("change", k => {
            osc1_release = k.value;
        });

        knob.emit("change", knob);

        const div = document.createElement("div");
        div.innerHTML =
            "<br><br><br><br><center>this space intentionally left blank</center><br><br><br><br>";
        html.appendChild(div);

        // notification
        synthNotification = new Notification({
            title: "Synthesize",
            html: html,
            duration: -1,
            target: "#synth-btn"
        });

        synthNotification.on("close", () => {
            const tip = document.getElementById("tooltip");

            if (tip) tip.parentNode.removeChild(tip);

            synthNotification = null;
        });
    };

    // snowflakes
    (() => {
        if (!configs.config.winter) return;

        (async () => {
            const snow = $(`<div id="tsparticles></div>`);

            $(document.body).prepend(snow);

            await tsParticles.load("tsparticles", {
                preset: "snow",
                particles: {
                    size: {
                        random: true,
                        value: 3
                    },
                    number: {
                        value: 250
                    }
                },
                background: {
                    color: "transparent"
                }
            });
        })();
    })();
});
