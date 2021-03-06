import MicroModal from 'micromodal';

import Audio from './audio';
import DriveLights from './drive_lights';
import { DISK_TYPES } from '../cards/disk2';
import { gamepad, configGamepad, initGamepad } from './gamepad';
import KeyBoard from './keyboard';
import Tape, { TAPE_TYPES } from './tape';

import ApplesoftDump from '../applesoft/decompiler';
import ApplesoftCompiler from '../applesoft/compiler';

import { debug, gup, hup } from '../util';
import Prefs from '../prefs';

var focused = false;
var startTime = Date.now();
var lastCycles = 0;
var lastFrames = 0;

var hashtag;

var disk_categories = {'Local Saves': []};
var disk_sets = {};
var disk_cur_name = [];
var disk_cur_cat = [];

var _apple2;
var cpu;
var stats;
var vm;
var tape;
var _disk2;
var audio;
var keyboard;
var io;
var _currentDrive = 1;

export const driveLights = new DriveLights();

export function dumpAppleSoftProgram() {
    var dumper = new ApplesoftDump(cpu);
    debug(dumper.toString());
}

export function compileAppleSoftProgram(program) {
    var compiler = new ApplesoftCompiler(cpu);
    compiler.compile(program);
}

export function openLoad(drive, event) {
    _currentDrive = parseInt(drive, 10);
    if (event.metaKey) {
        openLoadHTTP(drive);
    } else {
        if (disk_cur_cat[drive]) {
            document.querySelector('#category_select').value = disk_cur_cat[drive];
            selectCategory();
        }
        MicroModal.show('load-modal');
    }
}

export function openSave(drive, event) {
    _currentDrive = parseInt(drive, 10);

    var mimeType = 'application/octet-stream';
    var data = _disk2.getBinary(drive);
    var a = document.querySelector('#local_save_link');

    var blob = new Blob([data], { 'type': mimeType });
    a.href = window.URL.createObjectURL(blob);
    a.download = driveLights.label(drive) + '.dsk';

    if (event.metaKey) {
        dumpDisk(drive);
    } else {
        document.querySelector('#save_name').value = driveLights.label(drive);
        MicroModal.show('save-modal');
    }
}

export function handleDragOver(drive, event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

export function handleDragEnd(drive, event) {
    var dt = event.dataTransfer;
    if (dt.items) {
        for (var i = 0; i < dt.items.length; i++) {
            dt.items.remove(i);
        }
    } else {
        event.dataTransfer.clearData();
    }
}

export function handleDrop(drive, event) {
    event.preventDefault();
    event.stopPropagation();

    if (drive < 1) {
        if (!_disk2.getMetadata(1)) {
            drive = 1;
        } else if (!_disk2.getMetadata(2)) {
            drive = 2;
        } else {
            drive = 1;
        }
    }
    var dt = event.dataTransfer;
    if (dt.files.length == 1) {

        doLoadLocal(drive, dt.files[0]);
    } else if (dt.files.length == 2) {
        doLoadLocal(1, dt.files[0]);
        doLoadLocal(2, dt.files[1]);
    } else {
        for (var idx = 0; idx < dt.items.length; idx++) {
            if (dt.items[idx].type === 'text/uri-list') {
                dt.items[idx].getAsString(function(url) {
                    var parts = document.location.hash.split('|');
                    parts[drive - 1] = url;
                    document.location.hash = parts.join('|');
                });
            }
        }
    }
}

export function loadAjax(drive, url) {
    MicroModal.show('loading-modal');

    fetch(url).then(function(response) {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error('Error loading: ' + response.statusText);
        }
    }).then(function(data) {
        if (data.type == 'binary') {
            loadBinary(drive, data);
        } else if (DISK_TYPES.indexOf(data.type) > -1) {
            loadDisk(drive, data);
        }
        initGamepad(data.gamepad);
        MicroModal.close('loading-modal');
    }).catch(function(error) {
        MicroModal.close('loading-modal');
        window.alert(error.message);
    });
}

export function doLoad() {
    MicroModal.close('load-modal');
    var urls = document.querySelector('#disk_select').value, url;
    if (urls && urls.length) {
        if (typeof(urls) == 'string') {
            url = urls;
        } else {
            url = urls[0];
        }
    }

    var files = document.querySelector('#local_file').files;
    if (files.length == 1) {
        doLoadLocal(_currentDrive, files[0]);
    } else if (url) {
        var filename;
        MicroModal.close('load-modal');
        if (url.substr(0,6) == 'local:') {
            filename = url.substr(6);
            if (filename == '__manage') {
                openManage();
            } else {
                loadLocalStorage(_currentDrive, filename);
            }
        } else {
            var r1 = /json\/disks\/(.*).json$/.exec(url);
            if (r1) {
                filename = r1[1];
            } else {
                filename = url;
            }
            var parts = document.location.hash.split('|');
            parts[_currentDrive - 1] = filename;
            document.location.hash = parts.join('|');
        }
    }
}

export function doSave() {
    var name = document.querySelector('#save_name').value;
    saveLocalStorage(_currentDrive, name);
    MicroModal.close('save-modal');
}

export function doDelete(name) {
    if (window.confirm('Delete ' + name + '?')) {
        deleteLocalStorage(name);
    }
}

function doLoadLocal(drive, file) {
    var parts = file.name.split('.');
    var ext = parts[parts.length - 1].toLowerCase();
    if (DISK_TYPES.indexOf(ext) > -1) {
        doLoadLocalDisk(drive, file);
    } else if (TAPE_TYPES.indexOf(ext) > -1) {
        tape.doLoadLocalTape(file);
    } else {
        window.alert('Unknown file type: ' + ext);
    }
}

function doLoadLocalDisk(drive, file) {
    MicroModal.show('loading-modal');
    var fileReader = new FileReader();
    fileReader.onload = function() {
        var parts = file.name.split('.');
        var ext = parts.pop().toLowerCase();
        var name = parts.join('.');
        if (_disk2.setBinary(drive, name, ext, this.result)) {
            driveLights.label(drive, name);
            MicroModal.close('loading-modal');
            focused = false;
            initGamepad();
        }
    };
    fileReader.readAsArrayBuffer(file);
}

export function doLoadHTTP(drive, _url) {
    var url = _url || document.querySelector('#http_url').value;
    if (url) {
        fetch(url).then(function(response) {
            if (response.ok) {
                return response.arrayBuffer();
            } else {
                throw new Error('Error loading: ' + response.statusText);
            }
        }).then(function(data) {
            var urlParts = url.split('/');
            var file = urlParts.pop();
            var fileParts = file.split('.');
            var ext = fileParts.pop().toLowerCase();
            var name = decodeURIComponent(fileParts.join('.'));
            if (_disk2.setBinary(drive, name, ext, data)) {
                driveLights.label(drive, name);
                initGamepad();
            }
            if (!_url) { MicroModal.close('http-modal'); }
        }).catch(function(error) {
            window.alert(error.message);
            if (!_url) { MicroModal.close('http-modal'); }
        });
    }
}

function openLoadHTTP(drive) {
    _currentDrive = parseInt(drive, 10);
    MicroModal.show('http-modal');
}

function openManage() {
    MicroModal.show('manage-modal');
}

var prefs = new Prefs();
var showFPS = false;

export function updateKHz() {
    var now = Date.now();
    var ms = now - startTime;
    var cycles = cpu.cycles();
    var delta;

    if (showFPS) {
        delta = stats.renderedFrames - lastFrames;
        var fps = parseInt(delta/(ms/1000), 10);
        document.querySelector('#khz').innerText = fps + 'fps';
    } else {
        delta = cycles - lastCycles;
        var khz = parseInt(delta/ms);
        document.querySelector('#khz').innerText = khz + 'KHz';
    }

    startTime = now;
    lastCycles = cycles;
    lastFrames = stats.renderedFrames;
}

export function toggleShowFPS() {
    showFPS = !showFPS;
}

export function updateSound() {
    var on = document.querySelector('#enable_sound').checked;
    var label = document.querySelector('#toggle-sound i');
    audio.enable(on);
    if (on) {
        label.classList.remove('fa-volume-off');
        label.classList.add('fa-volume-up');
    } else {
        label.classList.remove('fa-volume-up');
        label.classList.add('fa-volume-off');
    }
}

function dumpDisk(drive) {
    var wind = window.open('', '_blank');
    wind.document.title = driveLights.label(drive);
    wind.document.write('<pre>');
    wind.document.write(_disk2.getJSON(drive, true));
    wind.document.write('</pre>');
    wind.document.close();
}

export function reset() {
    _apple2.reset();
}

function loadBinary(bin) {
    for (var idx = 0; idx < bin.length; idx++) {
        var pos = bin.start + idx;
        cpu.write(pos >> 8, pos & 0xff, bin.data[idx]);
    }
    cpu.reset();
    cpu.setPC(bin.start);
}

export function selectCategory() {
    document.querySelector('#disk_select').innerHTML = '';
    var cat = disk_categories[document.querySelector('#category_select').value];
    if (cat) {
        for (var idx = 0; idx < cat.length; idx++) {
            var file = cat[idx], name = file.name;
            if (file.disk) {
                name += ' - ' + file.disk;
            }
            var option = document.createElement('option');
            option.value = file.filename;
            option.innerText = name;
            document.querySelector('#disk_select').append(option);
            if (disk_cur_name[_currentDrive] == name) {
                option.selected = true;
            }
        }
    }
}

export function selectDisk() {
    document.querySelector('#local_file').value = '';
}

export function clickDisk() {
    doLoad();
}

function loadDisk(drive, disk) {
    var name = disk.name;
    var category = disk.category;

    if (disk.disk) {
        name += ' - ' + disk.disk;
    }

    disk_cur_cat[drive] = category;
    disk_cur_name[drive] = name;

    driveLights.label(drive, name);
    _disk2.setDisk(drive, disk);
    initGamepad(disk.gamepad);
}

/*
 *  LocalStorage Disk Storage
 */

function updateLocalStorage() {
    var diskIndex = JSON.parse(window.localStorage.diskIndex || '{}');
    var names = [], name, cat;

    for (name in diskIndex) {
        if (diskIndex.hasOwnProperty(name)) {
            names.push(name);
        }
    }

    cat = disk_categories['Local Saves'] = [];
    document.querySelector('#manage-modal-content').innerHTML = '';

    names.forEach(function(name) {
        cat.push({
            'category': 'Local Saves',
            'name': name,
            'filename': 'local:' + name
        });
        document.querySelector('#manage-modal-content').innerHTML =
            '<span class="local_save">' +
            name +
            ' <a href="#" onclick="Apple2.doDelete(\'' +
            name +
            '\')">Delete</a><br /></span>';
    });
    cat.push({
        'category': 'Local Saves',
        'name': 'Manage Saves...',
        'filename': 'local:__manage'
    });
}

function saveLocalStorage(drive, name) {
    var diskIndex = JSON.parse(window.localStorage.diskIndex || '{}');

    var json = _disk2.getJSON(drive);
    diskIndex[name] = json;

    window.localStorage.diskIndex = JSON.stringify(diskIndex);

    window.alert('Saved');

    driveLights.label(drive, name);
    driveLights.dirty(drive, false);
    updateLocalStorage();
}

function deleteLocalStorage(name) {
    var diskIndex = JSON.parse(window.localStorage.diskIndex || '{}');
    if (diskIndex[name]) {
        delete diskIndex[name];
        window.alert('Deleted');
    }
    window.localStorage.diskIndex = JSON.stringify(diskIndex);
    updateLocalStorage();
}

function loadLocalStorage(drive, name) {
    var diskIndex = JSON.parse(window.localStorage.diskIndex || '{}');
    if (diskIndex[name]) {
        _disk2.setJSON(drive, diskIndex[name]);
        driveLights.label(drive, name);
        driveLights.dirty(drive, false);
    }
}

if (window.localStorage !== undefined) {
    document.querySelectorAll('.disksave').forEach(function (el) { el.style.display = 'inline-block';});
}

var oldcat = '';
var option;
for (var idx = 0; idx < window.disk_index.length; idx++) {
    var file = window.disk_index[idx];
    var cat = file.category;
    var name = file.name, disk = file.disk;
    if (file.e) {
        continue;
    }
    if (cat != oldcat) {
        option = document.createElement('option');
        option.value = cat;
        option.innerText = cat;
        document.querySelector('#category_select').append(option);

        disk_categories[cat] = [];
        oldcat = cat;
    }
    disk_categories[cat].push(file);
    if (disk) {
        if (!disk_sets[name]) {
            disk_sets[name] = [];
        }
        disk_sets[name].push(file);
    }
}
option = document.createElement('option');
option.innerText = 'Local Saves';
document.querySelector('#category_select').append(option);

updateLocalStorage();

function processHash(hash) {
    var files = hash.split('|');
    for (var idx = 0; idx < files.length; idx++) {
        var file = files[idx];
        if (file.indexOf('://') > 0) {
            var parts = file.split('.');
            var ext = parts[parts.length - 1].toLowerCase();
            if (ext == 'json') {
                loadAjax(idx + 1, file);
            } else {
                doLoadHTTP(idx + 1, file);
            }
        } else if (file) {
            loadAjax(idx + 1, 'json/disks/' + file + '.json');
        }
    }
}

/*
 * Keyboard/Gamepad routines
 */

function _keydown(evt) {
    if (!focused && (!evt.metaKey || evt.ctrlKey)) {
        evt.preventDefault();

        var key = keyboard.mapKeyEvent(evt);
        if (key != 0xff) {
            io.keyDown(key);
        }
    }
    if (evt.keyCode === 112) { // F1 - Reset
        cpu.reset();
        evt.preventDefault(); // prevent launching help
    } else if (evt.keyCode === 113) { // F2 - Full Screen
        var elem = document.getElementById('screen');
        if (evt.shiftKey) { // Full window, but not full screen
            document.querySelector('#display').classList.toggle('zoomwindow');
            document.querySelector('#display > div').classList.toggle('overscan');
            document.querySelector('#display > div').classList.toggle('flexbox-centering');
            document.querySelector('#screen').classList.toggle('maxhw');
            document.querySelector('#header').classList.toggle('hidden');
            document.querySelectorAll('.inset').forEach(function(el) { el.classList.toggle('hidden'); });
            document.querySelector('#reset').classList.toggle('hidden');
        } else if (document.webkitCancelFullScreen) {
            if (document.webkitIsFullScreen) {
                document.webkitCancelFullScreen();
            } else {
                if (Element.ALLOW_KEYBOARD_INPUT) {
                    elem.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
                } else {
                    elem.webkitRequestFullScreen();
                }
            }
        } else if (document.mozCancelFullScreen) {
            if (document.mozIsFullScreen) {
                document.mozCancelFullScreen();
            } else {
                elem.mozRequestFullScreen();
            }
        }
    } else if (evt.keyCode === 114) { // F3
        io.keyDown(0x1b);
    } else if (evt.keyCode === 117) { // F6 Quick Save
        _apple2.saveState();
    } else if (evt.keyCode === 120) { // F9 Quick Restore
        _apple2.restoreState();
    } else if (evt.keyCode == 16) { // Shift
        keyboard.shiftKey(true);
    } else if (evt.keyCode == 20) { // Caps lock
        keyboard.capslockKey();
    } else if (evt.keyCode == 17) { // Control
        keyboard.controlKey(true);
    } else if (evt.keyCode == 91 || evt.keyCode == 93) { // Command
        keyboard.commandKey(true);
    } else if (evt.keyCode == 18) { // Alt
        if (evt.location == 1) {
            keyboard.optionKey(true);
        } else {
            keyboard.commandKey(true);
        }
    }
}

function _keyup(evt) {
    if (!focused)
        io.keyUp();

    if (evt.keyCode == 16) { // Shift
        keyboard.shiftKey(false);
    } else if (evt.keyCode == 17) { // Control
        keyboard.controlKey(false);
    } else if (evt.keyCode == 91 || evt.keyCode == 93) { // Command
        keyboard.commandKey(false);
    } else if (evt.keyCode == 18) { // Alt
        if (evt.location == 1) {
            keyboard.optionKey(false);
        } else {
            keyboard.commandKey(false);
        }
    }
}

export function updateScreen() {
    var green = document.querySelector('#green_screen').checked;
    var scanlines = document.querySelector('#show_scanlines').checked;

    vm.green(green);
    vm.scanlines(scanlines);
}

export function updateCPU() {
    var accelerated = document.querySelector('#accelerator_toggle').checked;
    var kHz = accelerated ? 4092 : 1023;
    io.updateKHz(kHz);
}

export function updateUI() {
    if (document.location.hash != hashtag) {
        hashtag = document.location.hash;
        var hash = hup();
        if (hash) {
            processHash(hash);
        }
    }
}

var disableMouseJoystick = false;
var flipX = false;
var flipY = false;
var swapXY = false;

export function updateJoystick() {
    disableMouseJoystick = document.querySelector('#disable_mouse').checked;
    flipX = document.querySelector('#flip_x').checked;
    flipY = document.querySelector('#flip_y').checked;
    swapXY = document.querySelector('#swap_x_y').checked;
    configGamepad(flipX, flipY);

    if (disableMouseJoystick) {
        io.paddle(0, 0.5);
        io.paddle(1, 0.5);
        return;
    }
}

function _mousemove(evt) {
    if (gamepad || disableMouseJoystick) {
        return;
    }

    var s = document.querySelector('#screen');
    var offset = s.getBoundingClientRect();
    var x = (evt.pageX - offset.left) / s.clientWidth,
        y = (evt.pageY - offset.top) / s.clientHeight,
        z = x;

    if (swapXY) {
        x = y;
        y = z;
    }

    io.paddle(0, flipX ? 1 - x : x);
    io.paddle(1, flipY ? 1 - y : y);
}

var paused = false;

export function pauseRun() {
    var label = document.querySelector('#pause-run i');
    if (paused) {
        _apple2.run();
        label.classList.remove('fa-play');
        label.classList.add('fa-pause');
    } else {
        _apple2.stop();
        label.classList.remove('fa-pause');
        label.classList.add('fa-play');
    }
    paused = !paused;
}

export function toggleSound() {
    var enableSound = document.querySelector('#enable_sound');
    enableSound.checked = !enableSound.checked;
    updateSound();
}

export function openOptions() {
    MicroModal.show('options-modal');
}

export function openPrinterModal() {
    MicroModal.show('printer-modal');
}

export function initUI(apple2, disk2, e) {
    _apple2 = apple2;
    cpu = _apple2.getCPU();
    io = _apple2.getIO();
    stats = apple2.getStats();
    vm = apple2.getVideoModes();
    tape = new Tape(io);
    _disk2 = disk2;

    keyboard = new KeyBoard(cpu, io, e);
    keyboard.create('#keyboard');
    audio = new Audio(io);

    MicroModal.init();

    /*
     * Input Handling
     */

    window.addEventListener('keydown', _keydown);
    window.addEventListener('keyup', _keyup);
    window.addEventListener('mousedown', function() { audio.autoStart(); });

    document.querySelectorAll('canvas').forEach(function(canvas) {
        canvas.addEventListener('mousedown', function(evt) {
            if (!gamepad) {
                io.buttonDown(evt.which == 1 ? 0 : 1);
            }
            evt.preventDefault();
        });
        canvas.addEventListener('mouseup', function(evt) {
            if (!gamepad) {
                io.buttonUp(evt.which == 1 ? 0 : 1);
            }
        });
    });

    document.body.addEventListener('mousemove', _mousemove);

    document.querySelectorAll('input,textarea').forEach(function(input) {
        input.addEventListener('input', function() { focused = true; });
        input.addEventListener('focus', function() { focused = true; });
        input.addEventListener('blur', function() { focused = false; });
    });

    if (prefs.havePrefs()) {
        document.querySelectorAll('#options-modal input[type=checkbox]').forEach(function(el) {
            var val = prefs.readPref(el.id);
            if (val) {
                el.checked = JSON.parse(val);
            }
            el.addEventListener('change', function() {
                prefs.writePref(el.id, JSON.stringify(el.checked));
            });
        });
        document.querySelectorAll('#options-modal select').forEach(function(el) {
            var val = prefs.readPref(el.id);
            if (val) {
                el.value = val;
            }
            el.addEventListener('change', function() {
                prefs.writePref(el.id, el.value);
            });
        });
    }

    cpu.reset();
    setInterval(updateKHz, 1000);
    updateSound();
    updateScreen();
    updateCPU();
    initGamepad();

    // Check for disks in hashtag

    var hash = gup('disk') || hup();
    if (hash) {
        processHash(hash);
    }

    if (navigator.standalone) {
        document.body.classList.add('standalone');
    }

    _apple2.run();
}
