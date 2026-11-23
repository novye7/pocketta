"use strict";
// The hover button is a content script; the picker is injected on first use.
const HOVER = ["components.js", "hover.js"];
const PICKER = ["color.js", "capture.js", "outline.js", "native-svg.js", "raster.js", "exporter.js", "picker.js"];
const SITE = "https://chatgpt.com/*";
const TITLE = "ChatGPT UI 导出";

async function start(tab) {
  try {
    if (!tab?.id || !tab.url || new URL(tab.url).origin !== "https://chatgpt.com") throw new Error("请先打开 chatgpt.com 的对话页面。");
    // The hover files go along, for a tab that was open before the extension was loaded.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [...HOVER, ...PICKER] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: TITLE });
  } catch (error) {
    if (!tab?.id) return;
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d93025" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: error.message || "无法启动导出工具，请刷新页面后重试。" });
  }
}

// The toolbar icon and the shortcut open the picker in the current tab, or close it again.
chrome.action.onClicked.addListener(start);

// The hover button (hover.js) opens it with a component already chosen.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "chatgpt-ui-export:start" || sender.id !== chrome.runtime.id || !sender.tab) return;
  start(sender.tab).then(() => respond(true));
  return true;
});

// Content scripts only reach pages loaded later, so conversations that are
// already open get the hover button here, without a refresh.
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: SITE })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: HOVER }).catch(() => {});
  }
});
