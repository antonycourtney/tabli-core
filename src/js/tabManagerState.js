/**
 * application state for tab manager
 *
 * We'll instantiate and initialize this in the bgHelper and attach it to the background window,
 * and then retrieve the instance from the background window in the popup
 */
import * as _ from 'lodash';
import * as Immutable from 'immutable';
import * as TabWindow from './tabWindow';

export default class TabManagerState extends Immutable.Record({
  windowIdMap: Immutable.Map(),     // maps from chrome window id for open windows
  bookmarkIdMap: Immutable.Map(),   // maps from bookmark id for saved windows
  folderId: -1,
  archiveFolderId: -1,
}) {
  /**
   * Update store to include the specified window, indexed by
   * open window id or bookmark id
   *
   * Note that if an earlier snapshot of tabWindow is in the store, it will be
   * replaced
   */
  registerTabWindow(tabWindow) {
    const nextWindowIdMap =
      (tabWindow.open) ? this.windowIdMap.set(tabWindow.openWindowId, tabWindow) : this.windowIdMap;
    const nextBookmarkIdMap =
      (tabWindow.saved) ? this.bookmarkIdMap.set(tabWindow.savedFolderId, tabWindow) : this.bookmarkIdMap;

    return this.set('windowIdMap', nextWindowIdMap).set('bookmarkIdMap', nextBookmarkIdMap);
  }

  registerTabWindows(tabWindows) {
    return _.reduce(tabWindows, (acc, w) => acc.registerTabWindow(w), this);
  }

  handleTabWindowClosed(tabWindow) {
    // console.log("handleTabWindowClosed: ", tabWindow.toJS());
    /*
     * We only remove window from map of open windows (windowIdMap) but then we re-register
     * reverted window to ensure that a reverted version of saved window stays in
     * bookmarkIdMap.
     */
    const closedWindowIdMap = this.windowIdMap.delete(tabWindow.openWindowId);

    const revertedWindow = TabWindow.removeOpenWindowState(tabWindow);

    return this.set('windowIdMap', closedWindowIdMap).registerTabWindow(revertedWindow);
  }

  handleTabClosed(tabWindow, tabId) {
    var updWindow = TabWindow.closeTab(tabWindow, tabId);
    return this.registerTabWindow(updWindow);
  }

  handleTabSaved(tabWindow, tabItem, tabNode) {
    var updWindow = TabWindow.saveTab(tabWindow, tabItem, tabNode);
    return this.registerTabWindow(updWindow);
  }

  handleTabUnsaved(tabWindow, tabItem) {
    var updWindow = TabWindow.unsaveTab(tabWindow, tabItem);
    return this.registerTabWindow(updWindow);
  }

  /**
   * attach a Chrome window to a specific tab window (after opening a saved window)
   */
  attachChromeWindow(tabWindow, chromeWindow) {
    // console.log("attachChromeWindow: ", tabWindow.toJS(), chromeWindow);

    // Was this Chrome window id previously associated with some other tab window?
    const oldTabWindow = this.windowIdMap.get(chromeWindow.id);

    // A store without oldTabWindow
    const rmStore = oldTabWindow ? this.handleTabWindowClosed(oldTabWindow) : this;

    const attachedTabWindow = TabWindow.updateWindow(tabWindow, chromeWindow);

    console.log('attachChromeWindow: attachedTabWindow: ', attachedTabWindow.toJS());

    return rmStore.registerTabWindow(attachedTabWindow);
  }

  /**
   * Synchronize internal state of our store with snapshot
   * of current Chrome window state
   *
   * @param chromeWindow window to synchronize
   */
  syncChromeWindow(chromeWindow) {
    const prevTabWindow = this.windowIdMap.get(chromeWindow.id);
    /*
    if (!prevTabWindow) {
      console.log("syncChromeWindow: detected new chromeWindow: ", chromeWindow);
    }
    */
    const tabWindow = prevTabWindow ? TabWindow.updateWindow(prevTabWindow, chromeWindow) : TabWindow.makeChromeTabWindow(chromeWindow);

    return this.registerTabWindow(tabWindow);
  }

  /**
   * synchronize the currently open windows from chrome.windows.getAll with
   * internal map of open windows
   */
  syncWindowList(chromeWindowList) {
    var tabWindows = this.getOpen();

    // Iterate through tab windows (our current list of open windows)
    // closing any not in chromeWindowList:
    var chromeIds = _.map(chromeWindowList, 'id');
    var chromeIdSet = new Set(chromeIds);

    var closedWindows = _.filter(tabWindows, (tw) => !chromeIdSet.has(tw.openWindowId));

    var closedWinStore = _.reduce(closedWindows, (acc, tw) => acc.handleTabWindowClosed(tw), this);

    // Now update all open windows:
    return _.reduce(chromeWindowList, (acc, cw) => acc.syncChromeWindow(cw), closedWinStore);
  }

  setCurrentWindow(windowId) {
    const tabWindow = this.getTabWindowByChromeId(windowId);

    if (!tabWindow) {
      console.log('setCurrentWindow: window id ', windowId, 'not found');
      return this;
    }

    // TODO: We really should find any other window with focus===true and clear it
    const updWindow = tabWindow.set('focused', true);
    return this.registerTabWindow(updWindow);
  }

  removeBookmarkIdMapEntry(tabWindow) {
    return this.set('bookmarkIdMap', this.bookmarkIdMap.delete(tabWindow.savedFolderId));
  }

  unmanageWindow(tabWindow) {
    // Get a view of this store with tabWindow removed from bookmarkIdMap:
    const rmStore = this.removeBookmarkIdMapEntry(tabWindow);

    // disconnect from the previously associated bookmark folder and re-register
    const umWindow = TabWindow.removeSavedWindowState(tabWindow);
    return rmStore.registerTabWindow(umWindow);
  }

  /**
   * attach a bookmark folder to a specific chrome window
   */
  attachBookmarkFolder(bookmarkFolder, chromeWindow) {
    const folderTabWindow = TabWindow.makeFolderTabWindow(bookmarkFolder);

    const mergedTabWindow = TabWindow.updateWindow(folderTabWindow, chromeWindow);

    // And re-register in store maps:
    return this.registerTabWindow(mergedTabWindow);
  }

  /**
   * get the currently open tab windows
   */
  getOpen() {
    const openWindows = this.windowIdMap.toIndexedSeq().toArray();
    return openWindows;
  }

  getAll() {
    const openWindows = this.getOpen();
    const closedSavedWindows = this.bookmarkIdMap.toIndexedSeq().filter((w) => !(w.open)).toArray();
    return openWindows.concat(closedSavedWindows);
  }

  // returns a tabWindow or undefined
  getTabWindowByChromeId(windowId) {
    return this.windowIdMap.get(windowId);
  }

  countOpenWindows() {
    return this.windowIdMap.count();
  }

  countSavedWindows() {
    return this.bookmarkIdMap.count();
  }

  countOpenTabs() {
    return this.windowIdMap.reduce((count, w) => count + w.openTabCount, 0);
  }
}
