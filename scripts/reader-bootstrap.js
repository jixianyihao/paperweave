// PaperWeave bootstrap for the zotero/reader web build.
//
// The upstream web bundle (reader.js) only DEFINES window.createReader — the
// host page is responsible for calling it (upstream's own host is zotero's
// web-library). Without this bootstrap the built reader.html renders blank.
// build-reader.sh copies this file next to reader.html and injects a
// <script defer src="bootstrap.js"> tag into reader.html after copying.
//
// Usage: /reader/reader.html?file=/samples/sample.pdf[&type=pdf]
//
// The Reader calls most on* callbacks without guards, so we pass no-op
// implementations for the full set (mirroring vendor/zotero-reader/src/
// index.dev.js). 阶段 4 will replace these with the real deep bridge.
window.addEventListener('DOMContentLoaded', () => {
	const params = new URLSearchParams(window.location.search);
	const file = params.get('file');
	if (!file || window._reader) {
		return;
	}
	const noop = () => {};
	window.createReader({
		type: params.get('type') || 'pdf',
		data: { url: new URL(file, window.location.href).toString() },
		readOnly: false,
		annotations: [],
		showAnnotations: true,
		authorName: 'PaperWeave',
		sidebarWidth: 240,
		sidebarView: 'annotations',
		bottomPlaceholderHeight: null,
		toolbarPlaceholderWidth: 0,
		onSaveAnnotations: noop,
		onDeleteAnnotations: noop,
		onChangeViewState: noop,
		onOpenTagsPopup: noop,
		onClosePopup: noop,
		onOpenLink: (url) => window.open(url, '_blank', 'noopener'),
		onToggleSidebar: noop,
		onChangeSidebarWidth: noop,
		onChangeSidebarView: noop,
		onSetDataTransferAnnotations: noop,
		onConfirm: (title, text) => window.confirm(text),
		onRotatePages: noop,
		onDeletePages: noop,
		onToggleContextPane: noop,
		onTextSelectionAnnotationModeChange: noop,
		onSaveCustomThemes: noop,
		onSetReadAloudVoice: noop,
		onSetReadAloudStatus: noop,
	});
});
