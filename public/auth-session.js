(function () {
  'use strict';

  var refreshPromise = null;

  window.orivaRefreshSession = function () {
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    }).finally(function () {
      refreshPromise = null;
    });
    return refreshPromise;
  };
})();
