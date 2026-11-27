/* Fills elements marked with data-i18n / data-i18n-placeholder / data-i18n-aria from _locales. */
(function () {
  'use strict';
  const t = (k) => chrome.i18n.getMessage(k) || k;
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (document.title = t(el.dataset.i18nTitle)));
  window.t = t;
})();
