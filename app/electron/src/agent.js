/**
 * @author oldj
 * @blog http://oldj.net
 *
 * 和系统、平台相关的方法
 */

'use strict';

const fs = require('fs');
const path = require('path');
const request = require('request');
const moment = require('moment');
const util = require('./libs/util');
const platform = process.platform;

const paths = require('./libs/paths');
const pref = require('./libs/pref');
const sys_host_path = paths.sys_host_path;
const work_path = paths.work_path;
const data_path = paths.data_path;
const preference_path = paths.preference_path;

const exec = require('child_process').exec;
const stat = require('./modules/stat');
stat.init();

const crypto = require('crypto');
function md5 (text) {
    return crypto.createHash('md5').update(text).digest('hex');
}


const lang = require('./lang');
let sudo_pswd = '';

function getUserLang() {
    let user_lang;

    user_lang = pref.get('user_language') || navigator.language || navigator.userLanguage;
    if (user_lang === 'zh_CN') {
        user_lang = 'cn';
    } else {
        user_lang = 'en';
    }

    return user_lang;
}


function getSysHosts() {
    let cnt = '';

    try {
        cnt = fs.readFileSync(sys_host_path, 'utf-8');
    } catch (e) {
        console.log(e.message);
    }

    return cnt;
}

function tryToCreateWorkDir() {
    if (util.isDirectory((work_path))) {
        console.log('work dir exists.');
        return;
    }

    console.log(`try to create work directory: ${work_path}`);
    try {
        fs.mkdirSync(work_path);
        console.log('work directory created.');
    } catch (e) {
        alert('Fail to create work directory!');
    }
}

function saveData(content) {

    let txt = JSON.stringify({
        list: content
    });

    fs.writeFile(data_path, txt, 'utf-8', (error) => {
        if (error) {
            alert(error.message);
        }
    });
}


function apply_UNIX(tmp_fn, success) {
    let cmd;
    if (!sudo_pswd) {
        cmd = [
            'cat "' + tmp_fn + '" > ' + sys_host_path
            , 'rm -rf ' + tmp_fn
        ].join(' && ');
    } else {
        sudo_pswd = sudo_pswd.replace(/'/g, '\\x27');
        cmd = [
            'echo \'' + sudo_pswd + '\' | sudo -S chmod 777 ' + sys_host_path
            , 'cat "' + tmp_fn + '" > ' + sys_host_path
            , 'echo \'' + sudo_pswd + '\' | sudo -S chmod 644 ' + sys_host_path
            // , 'rm -rf ' + tmp_fn
        ].join(' && ');
    }

    exec(cmd, function(error, stdout, stderr) {
        // command output is in stdout
        if (error) {
            if (!sudo_pswd) {
                // 尝试让用户输入管理密码
                SH_event.emit('sudo_prompt', (pswd) => {
                    sudo_pswd = pswd;
                    tryToApply(null, success);
                });
            } else {
                alert(stderr);
            }
            return;
        }

        if (!error) {
            after_apply(success);
        }
    });
}

function _after_apply_unix(callback) {
    let cmd_fn = path.join(work_path, '_restart_mDNSResponder.sh');

    let cmd = [
        'sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.mDNSResponder.plist'
        , 'sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.mDNSResponder.plist'
        , 'sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.discoveryd.plist'
        , 'sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.discoveryd.plist'
        , 'sudo killall -HUP mDNSResponder'
    ].join('\n');

    fs.writeFileSync(cmd_fn, cmd, 'utf-8');

    exec(`/bin/sh ${cmd_fn}`, function(error, stdout, stderr) {
        // command output is in stdout
        if (error) {
            console.log(error);
        }
        console.log(stdout, stderr);

        callback();
    });
}

function after_apply(callback) {

    SH_event.emit('after_apply');

    if (!sudo_pswd) {
        callback();
        return;
    }

    if (platform === 'darwin') {
        _after_apply_unix(callback);
        return;
    }

    callback();
}

function apply_Win32(content, success) {
    // todo 判断写入权限
    try {
        fs.writeFileSync(sys_host_path, content, 'utf-8');
    } catch (e) {
        console.log(e);
        return;
    }
    success && success();

    // todo 更新 DNS 缓存
}


function tryToApply(content, success) {
    let tmp_fn = path.join(work_path, 'tmp.txt');
    if (content) {
        fs.writeFileSync(tmp_fn, content, 'utf-8');
    }

    if (platform !== 'win32') {
        apply_UNIX(tmp_fn, success);
    } else {
        apply_Win32(tmp_fn, success);
    }
}


// init
tryToCreateWorkDir();

SH_event.on('test', () => {
    console.log('ttt');
});

SH_event.on('apply', (content, success) => {
    success = success || function () {};
    tryToApply(content, success);
});

SH_event.on('sudo_pswd', (pswd) => {
    sudo_pswd = pswd;
});

SH_event.on('save_data', (content) => {
    saveData(content);
    ipcRenderer.send('send_host_list', content);
});

SH_event.on('check_host_refresh', (host, force=false) => {
    if (host.where !== 'remote' || !host.url || !host.refresh_interval) return;

    let last_refresh = host.last_refresh;
    let refresh_interval = parseInt(host.refresh_interval) || 0;
    if (last_refresh && !force) {
        last_refresh = new Date(last_refresh);
        let delta = (new Date()).getTime() - (last_refresh.getTime() || 0) / (1000 * 3600);
        if (delta < refresh_interval) {
            return;
        }
    }

    // refresh
    console.log(`getting '${host.url}' ..`);
    SH_event.emit('loading', host, true);
    host.is_loading = true;
    request(host.url, (err, res, body) => {
        console.log(err, res.statusCode);
        SH_event.emit('loading', host, false);
        host.is_loading = false;
        if (!err && res.statusCode === 200) {
            // console.log(body);
            host.content = body;
            host.last_refresh = moment().format('YYYY-MM-DD HH:mm:ss');

            SH_event.emit('change');
        } else {
            console.log(err, res.statusCode);
        }
    });
});

/**
 * 如果本地没有 data 文件，认为是第一次运行
 */
function initGet() {
    let dd = require('./libs/default_data');
    let data = dd.make();

    data.sys.content = getSysHosts();
    data.list.push({
        title: 'backup',
        content: data.sys.content
    });

    return data;
}

module.exports = {
    md5: md5,
    getHosts: function () {
        let data = null;

        if (!util.isFile(data_path)) {
            return initGet();
        }

        try {
            let cnt = fs.readFileSync(data_path, 'utf-8');
            data = JSON.parse(cnt);
        } catch (e) {
            console.log(e);
            alert('bad data file.. :(');
            return initGet();
        }

        return {
            sys: {
                is_sys: true
                , content: getSysHosts()
            },
            list: data.list.map((i) => {
                return {
                    title: i.title || ''
                    , content: i.content || ''
                    , on: !!i.on
                    , where: i.where || 'local'
                    , url: i.url || ''
                    , last_refresh: i.last_refresh || null
                    , refresh_interval: i.refresh_interval || 0
                }
            })
        };
    },
    getSysHosts: function () {
        return {
            is_sys: true
            , content: getSysHosts()
        }
    },
    lang: lang.getLang(getUserLang())
};