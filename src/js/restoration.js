const fse = require('fs-extra');
const os = require('os');
const path = require("path");
const { ipcRenderer } = require("electron");

const { app } = require('@electron/remote');

const execSync = require('child_process').execSync;
const exec = require('child_process').exec;
const { spawn } = require('child_process');

const remote = require('@electron/remote');
const ffmpeg = require('fluent-ffmpeg');

let ffmpegPath;
let ffprobePath;

if (remote.app.isPackaged == false) {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
} else {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked');
    ffprobePath = require('@ffprobe-installer/ffprobe').path.replace('app.asar', 'app.asar.unpacked');
}
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const terminal = document.getElementById("terminal-text");
const enhancrPrefix = "[enhancr]";
const progressSpan = document.getElementById("progress-span");

const blankModal = document.getElementById("blank-modal");
const subsModal = document.getElementById("modal");

function openModal(modal) {
    if (modal == undefined) return
    modal.classList.add('active')
    overlay.classList.add('active')
}

const isPackaged = remote.app.isPackaged;

const successModal = document.getElementById("modal-success");
const successTitle = document.getElementById("success-title");
const thumbModal = document.getElementById("thumb-modal");

const preview = document.getElementById('preview-check');

sessionStorage.setItem('stopped', 'false');

const trtVersion = '8.6.1';

class Restoration {
    static async process(file, model, output, params, extension, engine, fileOut, index) {
        let cacheInputText = document.getElementById('cache-input-text');
        var cache = path.normalize(cacheInputText.textContent);

        let previewPath = path.join(cache, '/preview');
        let previewDataPath = previewPath + '/data%02d.ts';
        const appDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")

        let stopped = sessionStorage.getItem('stopped');
        if (!(stopped == 'true')) {
            // set flag for started restoration process
            sessionStorage.setItem('status', 'restoring');
            sessionStorage.setItem('engine', engine);

            // render progresbar
            const loading = document.getElementById("loading");
            loading.style.display = "block";

            // check if output path field is filled
            if (document.getElementById('restore-output-path-text').innerHTML == '') {
                openModal(blankModal);
                terminal.innerHTML += "\r\n[Error] Output path not specified, cancelling.";
                sessionStorage.setItem('status', 'error');
                throw new Error('Output path not specified');
            }

            // create paths if not existing
            if (!fse.existsSync(cache)) {
                fse.mkdirSync(cache);
            };

            if (!fse.existsSync(output)) {
                fse.mkdirSync(output)
            };

            // clear temporary files
            fse.emptyDirSync(cache);
            console.log(enhancrPrefix + " tmp directory cleared");

            if (!fse.existsSync(previewPath)) {
                fse.mkdirSync(previewPath);
            };

            terminal.innerHTML += '\r\n' + enhancrPrefix + ' Preparing media for restoration process..';

            const ffmpeg = !isPackaged ? path.join(__dirname, '..', "external/ffmpeg/ffmpeg.exe") : path.join(process.resourcesPath, "external/ffmpeg/ffmpeg.exe");

            // convert gif to video
            const gifVideoPath = path.join(cache, path.parse(file).name + ".mkv");
            if (path.extname(file) == ".gif") {
                try {
                    execSync(`${ffmpeg} -y -loglevel error -i "${file}" "${gifVideoPath}"`);
                    file = gifVideoPath;
                } catch (err) {
                    terminal.innerHTML += '\r\n' + enhancrPrefix + ` Error: GIF preparation has failed.`;
                };
            }

            // scan media for subtitles
            const subsPath = path.join(cache, "subs.ass");
            try {
                execSync(`${ffmpeg} -y -loglevel error -i "${file}" -c:s copy ${subsPath}`);
            } catch (err) {
                //ignore
            };

            //get trtexec path
            function getTrtExecPath() {
                return !isPackaged ? path.join(__dirname, '..', "/external/python/bin/trtexec.exe") : path.join(process.resourcesPath, "/external/python/bin/trtexec.exe")
            }
            let trtexec = getTrtExecPath();

            //get python path
            function getPythonPath() {
                return !isPackaged ? path.join(__dirname, '..', "/external/python/python.exe") : path.join(process.resourcesPath, "/external/python/python.exe");
            }
            let python = getPythonPath();

            //get conversion script
            function getConversionScript() {
                return !isPackaged ? path.join(__dirname, '..', "/utils/convert_model_esrgan.py") : path.join(process.resourcesPath, "/utils/convert_model_esrgan.py")
            }
            let convertModel = getConversionScript();

            var customModel = path.join(appDataPath, '/.enhancr/models/RealESRGAN', document.getElementById('custom-model-text').innerHTML);

            // convert pth to onnx
            if (document.getElementById('custom-model-check').checked && path.extname(customModel) == ".pth" && (engine == "Restoration - RealESRGAN (1x) (NCNN)" || engine == "Restoration - RealESRGAN (1x) (DirectML)" || engine == "Restoration - RealESRGAN (1x) (TensorRT)")) {
                function convertToOnnx() {
                    return new Promise(function(resolve) {
                        var cmd = `"${python}" "${convertModel}" --input="${path.join(appDataPath, '/.enhancr/models/RealESRGAN', document.getElementById('custom-model-text').innerHTML)}" --output="${path.join(cache, path.parse(customModel).name + '.onnx')}"`;
                        let term = spawn(cmd, [], { shell: true, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
                        process.stdout.write('');
                        term.stdout.on('data', (data) => {
                            process.stdout.write(`${data}`);
                            terminal.innerHTML += data;
                        });
                        term.stderr.on('data', (data) => {
                            process.stderr.write(`${data}`);
                            progressSpan.innerHTML = path.basename(file) + ' | Converting pth to onnx..';
                            terminal.innerHTML += data;
                        });
                        term.on("close", () => {
                            resolve();
                        });
                    })
                }
                await convertToOnnx();
            }

            //get onnx input path
            function getOnnxPath() {
                if (engine == 'Restoration - DPIR (TensorRT)' && model == 'Denoise') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/dpir/dpir_denoise.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/dpir/dpir_denoise.onnx")
                } else if (engine == 'Restoration - DPIR (TensorRT)' && model == 'Deblock') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/dpir/dpir_deblock.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/dpir/dpir_deblock.onnx")
                } else if (engine == 'Restoration - DPIR (DirectML)' && model == 'Denoise') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/dpir/dpir_denoise.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/dpir/dpir_denoise.onnx")
                } else if (engine == 'Restoration - DPIR (DirectML)' && model == 'Deblock') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/dpir/dpir_deblock.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/dpir/dpir_deblock.onnx")
                } else if (engine == 'Restoration - ScuNET (TensorRT)' && model == 'Strength: 15%') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_15_opset18_fp32_sim.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_15_opset18_fp32_sim.onnx")
                } else if (engine == 'Restoration - ScuNET (TensorRT)' && model == 'Strength: 25%') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_25_opset18_fp32_sim.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_25_opset18_fp32_sim.onnx")
                } else if (engine == 'Restoration - ScuNET (TensorRT)' && model == 'Strength: 50%') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_50_opset18_fp32_sim.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_50_opset18_fp32_sim.onnx")
                } else if (engine == 'Restoration - ScuNET (TensorRT)' && model == 'Strength: GAN') {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_real_gan_opset18_fp32_sim.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/scunet/scunet_color_real_gan_opset18_fp32_sim.onnx")
                } else if (engine == 'Restoration - RealESRGAN (1x) (TensorRT)' && !(document.getElementById('custom-model-check').checked)) {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx")
                } else if (engine == 'Restoration - RealESRGAN (1x) (NCNN)' && !(document.getElementById('custom-model-check').checked)) {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx")
                } else if (engine == 'Restoration - RealESRGAN (1x) (DirectML)' && !(document.getElementById('custom-model-check').checked)) {
                    return !isPackaged ? path.join(__dirname, '..', "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx") : path.join(process.resourcesPath, "/external/python/vapoursynth64/plugins/models/esrgan/animevideov3.onnx")
                } else {
                    terminal.innerHTML += '\r\n[enhancr] Using custom model: ' + customModel;
                    if (path.extname(customModel) == ".pth") {
                        return path.join(cache, path.parse(customModel).name + '.onnx');
                    } else {
                        return path.join(appDataPath, '/.enhancr/models/RealESRGAN', document.getElementById('custom-model-text').innerHTML);
                    }
                }
            }
            var onnx = getOnnxPath();

            let floatingPoint = document.getElementById('fp16-check').checked;
            let fp = floatingPoint ? "fp16" : "fp32";

            let shapeOverride = document.getElementById('shape-check').checked;
            let shapeDimensionsMax = shapeOverride ? document.getElementById('shape-res').value : '1088x1920';
            let shapeDimensionsMaxSplit = shapeDimensionsMax.split('x');
            let shapeWidth = parseInt(shapeDimensionsMaxSplit[0]);
            let shapeHeight = parseInt(shapeDimensionsMaxSplit[1]);

            let halfWidth = Math.ceil(shapeWidth / 2);
            let halfHeight = Math.ceil(shapeHeight / 2);

            let adjustedWidth = Math.floor(halfWidth / 8) * 8;
            let adjustedHeight = Math.floor(halfHeight / 8) * 8;

            let shapeDimensionsOpt = adjustedHeight + 'x' + adjustedWidth;

            let dimensions = document.getElementById('dimensionsRes');
            // get width & height
            function getWidth() {
                return parseInt((dimensions.innerHTML).split(' x')[0]);
            };
            let width = getWidth();
            
            function getHeight() {
                return parseInt(((dimensions.innerHTML).split('x ')[1]).split(' ')[0]);
            };
            let height = getHeight();

            // get engine path
            function getEnginePath() {
                if (engine == 'Restoration - ScuNET (TensorRT)') {
                    return path.join(appDataPath, '/.enhancr/models/engine', `${path.parse(onnx).name}-${fp}_${height}x${width}_trt_${trtVersion}.engine`);
                } else if (engine == "Restoration - RealESRGAN (1x) (NCNN)" || engine == "Restoration - RealESRGAN (1x) (DirectML)") {
                    return onnx;
                } else {
                    return path.join(appDataPath, '/.enhancr/models/engine', `${path.parse(onnx).name}-${fp}_${shapeDimensionsMax}_trt_${trtVersion}.engine`);
                }
            }
            let engineOut = getEnginePath();
            sessionStorage.setItem('engineOut', engineOut);

            let fp16 = document.getElementById('fp16-check');

            let dim = () => {
                if (engine == 'Restoration - DPIR (TensorRT)') return "4";
                else return "3";
            }

            const getOnnxPrecisionScript = () => {
                return !isPackaged ? path.join(__dirname, '..', "inference/utils/onnx_precision.py") : path.join(process.resourcesPath, "inference/utils/onnx_precision.py")
            }

            let ioPrecision = () => {
                let onnxPrecision = execSync(`${python} ${getOnnxPrecisionScript()} --input=${onnx}`).toString();
                if (onnxPrecision.trim() === 'FLOAT16') return '--inputIOFormats=fp16:chw --outputIOFormats=fp16:chw';
                else return '';
            };

            let shapes = () => {
                if (engine == 'Restoration - ScuNET (TensorRT)') {
                    return `--optShapes=input:1x3x${height}x${width}`
                } else {
                    return `--minShapes=input:1x${dim()}x8x8 --optShapes=input:1x${dim()}x${shapeDimensionsOpt} --maxShapes=input:1x${dim()}x${shapeDimensionsMax}`
                }
            }

            // convert onnx to trt engine
            if (!fse.existsSync(engineOut) && (engine != 'Restoration - RealESRGAN (1x) (NCNN)' && engine != "Restoration - RealESRGAN (1x) (DirectML)" && engine != "Restoration - DPIR (DirectML)")) {
                function convertToEngine() {
                    return new Promise(function(resolve) {
                        if (fp16.checked == true) {
                            var cmd = `"${trtexec}" --fp16 --onnx="${onnx}" ${ioPrecision()} ${shapes()} --saveEngine="${engineOut}" --tacticSources=+CUDNN,-CUBLAS,-CUBLAS_LT --skipInference --preview=+fasterDynamicShapes0805,-disableExternalTacticSourcesForCore0805`;
                        } else {
                            var cmd = `"${trtexec}" --onnx="${onnx}" ${shapes()} --saveEngine="${engineOut}" --tacticSources=+CUDNN,-CUBLAS,-CUBLAS_LT --skipInference --preview=+fasterDynamicShapes0805,-disableExternalTacticSourcesForCore0805`;
                        }
                        let term = spawn(cmd, [], { shell: true, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
                        process.stdout.write('');
                        term.stdout.on('data', (data) => {
                            process.stdout.write(`${data}`);
                            terminal.innerHTML += data;
                        });
                        term.stderr.on('data', (data) => {
                            process.stderr.write(`${data}`);
                            progressSpan.innerHTML = path.basename(file) + ' | Converting onnx to engine..';
                            terminal.innerHTML += data;
                        });
                        term.on("close", () => {
                            sessionStorage.setItem('conversion', 'success');
                            resolve();
                        });
                    });
                }
                await convertToEngine();
            }

            // display infos in terminal for user
            terminal.innerHTML += '\r\n' + enhancrPrefix + ` Encoding parameters: ${params}`;
            terminal.innerHTML += '\r\n' + enhancrPrefix + ` Mode: ${engine}`;

            // resolve media framerate and pass to vsynth for working around VFR content
            let fps = parseFloat((document.getElementById('framerate').innerHTML).split(" ")[0]);

            const numStreams = document.getElementById('num-streams');

            // trim video if timestamps are set by user
            if (!(sessionStorage.getItem(`trim${index}`) == null)) {
                terminal.innerHTML += '\r\n[enhancr] Trimming video with timestamps ' + '"' + sessionStorage.getItem(`trim${index}`) + '"';
                let timestampStart = (sessionStorage.getItem(`trim${index}`)).split('-')[0];
                let timestampEnd = (sessionStorage.getItem(`trim${index}`)).split('-')[1];
                let trimmedOut = path.join(cache, path.parse(file).name + '.mkv');
                try {
                    function trim() {
                        return new Promise(function(resolve) {
                            if (document.getElementById("trim-check").checked) {
                                var cmd = `"${ffmpeg}" -y -loglevel error -ss ${timestampStart} -to ${timestampEnd} -i "${file}" -c copy -c:v libx264 -crf 14 -max_interleave_delta 0 "${trimmedOut}"`;
                            } else {
                                var cmd = `"${ffmpeg}" -y -loglevel error -ss ${timestampStart} -to ${timestampEnd} -i "${file}" -c copy -max_interleave_delta 0 "${trimmedOut}"`;
                            }
                            let term = spawn(cmd, [], {
                                shell: true,
                                stdio: ['inherit', 'pipe', 'pipe'],
                                windowsHide: true
                            });
                            process.stdout.write('');
                            term.stdout.on('data', (data) => {
                                process.stdout.write(`${data}`);
                                terminal.innerHTML += data;
                            });
                            term.stderr.on('data', (data) => {
                                process.stderr.write(`${data}`);
                                terminal.innerHTML += data;
                            });
                            term.on("close", () => {
                                file = trimmedOut;
                                terminal.innerHTML += '\r\n[enhancr] Trimmed video successfully.';
                                resolve();
                            })
                        })
                    }
                    await trim();
                } catch (error) {
                    terminal.innerHTML('[Trim] ' + error)
                }
            }

            let modelCheck = model == 'Denoise';
            const denoiseStrength = document.getElementById('denoise-strength');
            const deblockStrength = document.getElementById('deblock-strength');

            let strengthParam = modelCheck ? denoiseStrength.value : deblockStrength.value;

            // cache file for passing info to the AI
            const jsonPath = path.join(cache, "tmp.json");
            let json = {
                file: file,
                engine: engineOut,
                framerate: fps,
                streams: numStreams.value,
                model: model,
                frameskip: document.getElementById('skip-check').checked,
                fp16: fp16.checked,
                onnx: onnx,
                strength: parseInt(strengthParam),
                tiling: document.getElementById("tiling-check").checked,
                tileHeight: (document.getElementById("tile-res").value).split('x')[1],
                tileWidth: (document.getElementById("tile-res").value).split('x')[0]
            };
            let data = JSON.stringify(json);
            // write data to json
            fse.writeFileSync(jsonPath, data, (err) => {
                if (err) {
                    console.log("Error writing file", err);
                };
            });

            // determine model
            if (engine == "Restoration - DPIR (TensorRT)") {
                model = "DPIR"
            } else if (engine == "Restoration - DPIR (DirectML)") {
                model = "DPIR"
            } else if (engine == "Restoration - ScuNET (TensorRT)") {
                model = "ScuNET"
            } else if (engine == "Restoration - RealESRGAN (1x) (TensorRT)") {
                model = "RealESRGAN-1x"
            } else {
                model = "RealESRGAN-1x"
            }

            // resolve output file path
            if (fileOut == null) {
                if (extension == "Frame Sequence") var outPath = path.join(output, path.parse(file).name + `_${model}-1x-${extension}`);
                else var outPath = path.join(output, path.parse(file).name + `_${model}-2x${extension}`);
                sessionStorage.setItem("pipeOutPath", outPath);
            } else {
                if (extension == "Frame Sequence") sessionStorage.setItem("pipeOutPath", `${path.join(output, fileOut + "-" + extension)}`);
                else sessionStorage.setItem("pipeOutPath", `${path.join(output, fileOut + extension)}`);
            }

            // determine ai engine
            function pickEngine() {
                if (engine == "Restoration - DPIR (TensorRT)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/dpir.py") : path.join(process.resourcesPath, "inference/dpir.py")
                }
                if (engine == "Restoration - DPIR (DirectML)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/dpir_dml.py") : path.join(process.resourcesPath, "inference/dpir_dml.py")
                }
                if (engine == "Restoration - ScuNET (TensorRT)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/scunet.py") : path.join(process.resourcesPath, "inference/scunet.py")
                }
                if (engine == "Restoration - RealESRGAN (1x) (TensorRT)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/esrgan.py") : path.join(process.resourcesPath, "inference/esrgan.py")
                }
                if (engine == "Restoration - RealESRGAN (1x) (NCNN)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/esrgan_ncnn.py") : path.join(process.resourcesPath, "inference/esrgan_ncnn.py")
                }
                if (engine == "Restoration - RealESRGAN (1x) (DirectML)") {
                    return !isPackaged ? path.join(__dirname, '..', "inference/esrgan_dml.py") : path.join(process.resourcesPath, "inference/esrgan_dml.py")
                }
            }
            var engine = pickEngine();

            // determine vspipe path
            function pickVspipe() {
                if (process.platform == "win32") {
                    if (document.getElementById('python-check').checked) {
                        return "vspipe"
                    } else {
                        return !isPackaged ? path.join(__dirname, '..', "\\external\\python\\VSPipe.exe") : path.join(process.resourcesPath, "\\external\\python\\VSPipe.exe");
                    }
                }
                if (process.platform == "linux") {
                    return "vspipe"
                }
                if (process.platform == "darwin") {
                    return "vspipe"
                }
            }
            let vspipe = pickVspipe();

            // inject env hook
            let inject_env = !isPackaged ? `"${path.join(__dirname, '..', "\\external\\python\\condabin\\conda_hook.bat")}" && "${path.join(__dirname, '..', "\\external\\python\\condabin\\conda_auto_activate.bat")}"` : `"${path.join(process.resourcesPath, "\\external\\python\\condabin\\conda_hook.bat")}" && "${path.join(process.resourcesPath, "\\external\\python\\condabin\\conda_auto_activate.bat")}"`;

            let mpv = () => {
                return !isPackaged ? path.join(__dirname, '..', "\\external\\mpv\\enhancr-mpv.exe") : path.join(process.resourcesPath, "\\external\\mpv\\enhancr-mpv.exe")
            }

            let mpvTitle = `enhancr - ${path.basename(sessionStorage.getItem("pipeOutPath"))} [${localStorage.getItem('gpu').split("GPU: ")[1]}]`


            let tmpOutPath = path.join(cache, Date.now() + ".mkv");
            if (extension != ".mkv" && fse.existsSync(subsPath) == true) {
                openModal(subsModal);
                terminal.innerHTML += "\r\n[Error] Input video contains subtitles, but output container is not .mkv, cancelling.";
                sessionStorage.setItem('status', 'error');
                throw new Error('Input video contains subtitles, but output container is not .mkv');
            } else {

                terminal.innerHTML += '\r\n' + enhancrPrefix + ` Starting restoration process..` + '\r\n';
                let previewEncoder = () => {
                    if (sessionStorage.getItem('gpu') == 'Intel') return '-c:v h264_qsv -preset fast -look_ahead 30 -q 25 -pix_fmt nv12'
                    if (sessionStorage.getItem('gpu') == 'AMD') return '-c:v h264_amf -quality balanced -rc cqp -qp 20 -pix_fmt nv12'
                    if (sessionStorage.getItem('gpu') == 'NVIDIA') return '-c:v h264_nvenc -preset llhq -b_adapt 1 -rc-lookahead 30 -qp 18 -qp_cb_offset -2 -qp_cr_offset -2 -pix_fmt nv12'
                }

                function restore() {
                    return new Promise(function(resolve) {
                        // if preview is enabled split out 2 streams from output
                        if (preview.checked == true) {
                            var cmd = `${inject_env} && "${vspipe}" --arg "tmp=${path.join(cache, "tmp.json")}" -c y4m "${engine}" - -p | "${ffmpeg}" -y -loglevel error -i pipe: ${params} -s ${width}x${height} "${tmpOutPath}" -f hls -hls_list_size 0 -hls_flags independent_segments -hls_time 0.5 -hls_segment_type mpegts -hls_segment_filename "${previewDataPath}" ${previewEncoder()} -s 1280x720 "${path.join(previewPath, '/master.m3u8')}"`;
                            console.log(cmd)
                            // if user selects realtime processing pipe to mpv
                        } else if (sessionStorage.getItem('realtime') == 'true') {
                            var cmd = `${inject_env} && "${vspipe}" --arg "tmp=${path.join(cache, "tmp.json")}" -c y4m "${engine}" - -p | "${mpv()}" --title="${mpvTitle}" --force-media-title=" " --audio-file="${file}" --sub-file="${file}" --external-file="${file}" --msg-level=all=no -`;
                        } else {
                            var cmd = `${inject_env} && "${vspipe}" --arg "tmp=${path.join(cache, "tmp.json")}" -c y4m "${engine}" - -p | "${ffmpeg}" -y -loglevel error -i pipe: ${params} -s ${width}x${height} "${tmpOutPath}"`;
                        }
                        let term = spawn(cmd, [], { shell: true, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
                        // merge stdout & stderr & write data to terminal
                        process.stdout.write('');
                        term.stdout.on('data', (data) => {
                            process.stdout.write(`[Pipe] ${data}`);
                        });
                        term.stderr.on('data', (data) => {
                            process.stderr.write(`[Pipe] ${data}`);
                            // remove leading and trailing whitespace, including newline characters
                            let dataString = data.toString().trim();
                            if (dataString.startsWith('Frame:')) {
                                // Replace the last line of the textarea with the updated line
                                terminal.innerHTML = terminal.innerHTML.replace(/([\s\S]*\n)[\s\S]*$/, '$1' + '[Pipe] ' + dataString);
                            } else if (!(dataString.startsWith('pipe:: Invalid data found when processing input'))) {
                                terminal.innerHTML += '\n[Pipe] ' + dataString;
                            } else {
                                sessionStorage.setItem('error', 'true');
                            }
                            sessionStorage.setItem('progress', data);
                        });
                        term.on("close", () => {
                            // don't merge streams if an error occurs
                            if (sessionStorage.getItem('error') == 'true') {
                                terminal.innerHTML += `\r\n[enhancr] An error has occured.`;
                                sessionStorage.setItem('status', 'done');
                                sessionStorage.setItem('error', 'false');
                                let errorCount = Number(sessionStorage.getItem("errorCount")) || 0;
                                errorCount++;
                                sessionStorage.setItem("errorCount", errorCount.toString());
                                resolve();
                            } else if ((sessionStorage.getItem('realtime') == 'false') || sessionStorage.getItem('realtime') == null) {
                                terminal.innerHTML += `\r\n[enhancr] Finishing up restoration..\r\n`;
                                terminal.innerHTML += `[enhancr] Muxing in streams..\r\n`;

                                // fix audio loss when muxing mkv
                                let mkv = extension == ".mkv";
                                let mkvFix = mkv ? "-max_interleave_delta 0" : "";

                                // fix muxing audio into webm
                                let webm = extension == ".webm";
                                let webmFix = webm ? "-c:a libopus -b:a 192k -c:v copy" : "-codec copy";

                                let out = sessionStorage.getItem('pipeOutPath');

                                const mkvmerge = !isPackaged ? path.join(__dirname, '..', "external/mkvtoolnix/mkvmerge.exe") : path.join(process.resourcesPath, "external/mkvtoolnix/mkvmerge.exe");
                                const mkvpropedit = !isPackaged ? path.join(__dirname, '..', "external/mkvtoolnix/mkvpropedit.exe") : path.join(process.resourcesPath, "external/mkvtoolnix/mkvpropedit.exe");

                                if (extension == "Frame Sequence") {
                                    fse.mkdirSync(path.join(output, path.basename(sessionStorage.getItem("pipeOutPath")) + "-" + Date.now()));
                                    terminal.innerHTML += `[enhancr] Exporting as frame sequence..\r\n`;
                                    var muxCmd = `"${ffmpeg}" -y -loglevel error -i "${tmpOutPath}" "${path.join(output, path.basename(sessionStorage.getItem("pipeOutPath")) + "-" + Date.now(), "output_frame_%04d.png")}"`;
                                } else {
                                    terminal.innerHTML += `[enhancr] Muxing in streams..\r\n`;
                                    if (extension == ".mp4" || extension == ".mov" || extension == ".webm") {
                                        var muxCmd = `"${ffmpeg}" -y -loglevel error -i "${file}" -i "${tmpOutPath}" -map 1? -map 0? -map -0:v -c:s srt -dn ${mkvFix} ${webmFix} "${out}"`;
                                    } else {
                                        var muxCmd = `"${mkvmerge}" --quiet -o "${out}" --no-video "${file}" "${tmpOutPath}" && "${mkvpropedit}" --quiet "${out}" --set "writing-application=enhancr v${app.getVersion()} 64-bit"`
                                    }
                                }

                                let muxTerm = spawn(muxCmd, [], { shell: true, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });

                                // merge stdout & stderr & write data to terminal
                                process.stdout.write('');
                                muxTerm.stdout.on('data', (data) => {
                                    process.stdout.write(`[Pipe] ${data}`);
                                    terminal.innerHTML += '[Muxer] ' + data;
                                });
                                muxTerm.stderr.on('data', (data) => {
                                    process.stderr.write(`[Pipe] ${data}`);
                                    terminal.innerHTML += '[Pipe] ' + data;
                                    sessionStorage.setItem('progress', data);
                                });
                                muxTerm.on("close", () => {
                                    // finish up restoration process
                                    terminal.innerHTML += `[enhancr] Completed restoring`;
                                    var notification = new Notification("Restoration completed", { icon: "./assets/enhancr.png", body: path.basename(file) });
                                    sessionStorage.setItem('status', 'done');
                                    ipcRenderer.send('rpc-done');
                                    successTitle.innerHTML = path.basename(sessionStorage.getItem("inputPathRestore"));
                                    thumbModal.src = path.join(appDataPath, '/.enhancr/thumbs/thumbRestoration.png?' + Date.now());
                                    resolve();
                                });
                            } else {
                                terminal.innerHTML += `[enhancr] Completed restoring`;
                                sessionStorage.setItem('status', 'done');
                                ipcRenderer.send('rpc-done');
                                resolve();
                            }
                        });
                    });
                }
                await restore();
            }
            // clear temporary files
            fse.emptyDirSync(cache);
            console.log("Cleared temporary cache files");
            // timeout for 2 seconds after restoration
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

module.exports = Restoration;