// 界面侧的状态副本：主进程推送 settings / sessions / runtime，界面订阅后重新渲染。
// 设置改动先在本地生效（拖动滑块不卡顿），等主进程回执 settingsAck 后再以主进程规范化后的值为准。
(function () {
  const { useEffect, useState } = preactHooks;

  const listeners = new Set();
  let serverSettings = null;
  let pending = [];
  let seq = 0;
  let current = { ready: false, settings: null, sessions: [], runtime: null, meta: {} };

  function effectiveSettings() {
    return pending.reduce((settings, entry) => ({ ...settings, ...entry.patch }), serverSettings);
  }

  function applySettings(settings, ack) {
    serverSettings = settings;
    pending = pending.filter((entry) => entry.seq > (ack || 0));
  }

  function publish() {
    current = { ...current, settings: effectiveSettings() };
    for (const listener of listeners) listener(current);
  }

  window.bloom.on('state', (message) => {
    const next = { ...current };
    if (message.settings) applySettings(message.settings, message.settingsAck);
    if (message.sessions) next.sessions = message.sessions;
    if (message.runtime) next.runtime = message.runtime;
    current = next;
    if (current.ready) publish();
  });

  const ready = window.bloom.snapshot().then((snapshot) => {
    applySettings(snapshot.settings, snapshot.settingsAck);
    current = {
      ready: true,
      settings: null,
      sessions: snapshot.sessions,
      runtime: snapshot.runtime,
      meta: { dataFile: snapshot.dataFile, version: snapshot.version }
    };
    publish();
  });

  function useBloom() {
    const [state, setState] = useState(current);
    useEffect(() => {
      listeners.add(setState);
      setState(current);
      return () => listeners.delete(setState);
    }, []);
    return state;
  }

  function updateSettings(patch) {
    seq += 1;
    pending.push({ seq, patch });
    window.bloom.updateSettings(patch, seq);
    if (current.ready) publish();
  }

  function act(name, ...args) {
    return window.bloom.action(name, ...args);
  }

  window.BloomClient = { useBloom, updateSettings, act, ready, get state() { return current; } };
})();
