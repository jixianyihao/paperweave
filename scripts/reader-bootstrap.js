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
// index.dev.js).
//
// 阶段 4+5: this file is also the iframe side of the PaperWeave reader bridge
// (contract: docs/superpowers/plans/2026-08-17-paperweave-phase45-contract.md,
// 流间接口 1; parent side: apps/web/src/reader/bridge.ts). It postMessages
// selection lifecycle events to the host window and answers jumpTo /
// clearSelection commands.
//
//   iframe → parent: { source: "pw-reader", type: "ready" }
//                    { source: "pw-reader", type: "selection",
//                      payload: { text, page, rect: {x,y,width,height}, position } }
//                    { source: "pw-reader", type: "selectionCleared" }
//                    { source: "pw-reader", type: "annotationsChanged",
//                      payload: { annotations: [{ id, type, text, comment, color,
//                                 page, pageLabel, position }], deletedIds? } }
//   parent → iframe: { source: "pw-host", type: "jumpTo", payload: { page?, position? } }
//                    { source: "pw-host", type: "clearSelection" }
//
// Annotation sync (reader → host only): the reader's annotation manager funnels
// creates AND updates through the createReader onSaveAnnotations option (1s
// debounce, full changed-annotation objects) and deletes through
// onDeleteAnnotations (annotation ids) — see the annotation-manager wiring in
// the built bundle (AnnotationManager{ onSave: this._onSaveAnnotations,
// onDelete: this._handleDeleteAnnotations }) and its _triggerSaving. These are
// the reader's official persistence callbacks, so they are the most robust
// detection point available without modifying vendor files; we simply forward
// normalized annotations to the host, which diffs and persists them.
//
// createReader's public options expose no selection hook, and vendor files may
// not be modified, so the bridge observes the reader's internal state: the
// reader funnels text-selection popup updates through Reader#_updateState as
// `primaryViewSelectionPopup` ({ rect: [x1,y1,x2,y2], annotation: { text,
//   position, pageLabel } } while a selection popup is active, undefined/null
// when it clears — see vendor/zotero-reader/src/common/reader.js onSetSelection-
// Popup and src/pdf/pdf-view.js _handlePointerUp). We wrap the instance method
// (prototype untouched) and dedupe consecutive identical popups, because the
// view re-emits the same popup with an updated rect while scrolling.
window.addEventListener('DOMContentLoaded', () => {
	// Reading Mode is EPUB/HTML-only upstream; the button still shows for PDFs
	// and errors when clicked. Hide it for our PDF-only reader.
	const style = document.createElement('style');
	style.textContent = 'button[aria-label="Reading Mode"],button[title="Reading Mode"]{display:none!important}';
	document.head.appendChild(style);

	const params = new URLSearchParams(window.location.search);
	const file = params.get('file');
	if (!file) {
		console.error('[paperweave] reader-bootstrap: no ?file= query parameter given; reader will render blank. Expected URL: reader.html?file=<path>[&type=pdf]');
		return;
	}
	if (window._reader) {
		return;
	}
	const noop = () => {};

	// --- bridge plumbing ----------------------------------------------------

	// Messages to the parent are validated there via event.source, so '*' is
	// acceptable and keeps the bridge working if the reader is ever served
	// from a different origin than the app shell.
	const postToHost = (message) => {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ source: 'pw-reader', ...message }, '*');
		}
	};

	// rect comes from the reader as [x1, y1, x2, y2] in iframe viewport
	// coordinates; the contract wants { x, y, width, height }.
	const normalizePopup = (popup) => {
		if (!popup || !popup.annotation || !Array.isArray(popup.rect)) {
			return null;
		}
		const [x1, y1, x2, y2] = popup.rect;
		if (![x1, y1, x2, y2].every((n) => typeof n === 'number' && Number.isFinite(n))) {
			return null;
		}
		const position = popup.annotation.position;
		if (!position || typeof position.pageIndex !== 'number') {
			return null;
		}
		return {
			text: popup.annotation.text || '',
			page: position.pageIndex + 1,
			rect: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
			// Reader-native position, passed through untouched so the host can
			// hand it back to jumpTo.
			position,
		};
	};

	// Dedupe key: the view re-emits the popup (new object identity, same
	// selection) while the page scrolls. The rect is part of the key so a
	// scroll-updated rect re-fires the selection event — the host needs it
	// to keep its floating menu anchored to the moving text. Identical
	// re-emissions (same selection, same rect) are still deduped.
	let lastSelectionKey = null;
	const handleSelectionPopup = (popup) => {
		const sel = normalizePopup(popup);
		if (!sel) {
			if (lastSelectionKey !== null) {
				lastSelectionKey = null;
				postToHost({ type: 'selectionCleared' });
			}
			return;
		}
		const key = JSON.stringify([sel.text, sel.page, sel.rect, sel.position]);
		if (key === lastSelectionKey) {
			return;
		}
		lastSelectionKey = key;
		postToHost({ type: 'selection', payload: sel });
	};

	const installSelectionHook = (reader) => {
		const original = reader._updateState.bind(reader);
		reader._updateState = function (state, init) {
			if (state && Object.prototype.hasOwnProperty.call(state, 'primaryViewSelectionPopup')) {
				try {
					handleSelectionPopup(state.primaryViewSelectionPopup);
				}
				catch (e) {
					console.error('[paperweave] selection hook error', e);
				}
			}
			return original(state, init);
		};
	};

	// --- annotation sync (reader → host) -------------------------------------

	// Reader annotation → bridge payload. Reader types: highlight, underline,
	// note, image, ink, text (mapping to backend types happens host-side).
	// page is 1-based (pageIndex + 1); notes and some ink/image annotations may
	// have no position at all (page null) — the host skips those it can't
	// place. position is passed through untouched so the host can store it and
	// hand it back to jumpTo.
	const normalizeAnnotation = (a) => {
		if (!a || typeof a.id !== 'string' || typeof a.type !== 'string') {
			return null;
		}
		const position = a.position && typeof a.position === 'object' ? a.position : null;
		return {
			id: a.id,
			type: a.type,
			text: typeof a.text === 'string' ? a.text : '',
			comment: typeof a.comment === 'string' ? a.comment : '',
			color: typeof a.color === 'string' ? a.color : null,
			page: position && typeof position.pageIndex === 'number' ? position.pageIndex + 1 : null,
			pageLabel: typeof a.pageLabel === 'string' ? a.pageLabel : null,
			position,
		};
	};

	// --- area capture (image annotations → PNG data URL) ------------------------
	//
	// When the user creates an area (image) annotation with the reader's
	// "Select Area" tool, we crop the region from the page's rendered <canvas>
	// in the DOM and forward it to the host as a data URL. DOM-based on purpose:
	// no dependency on reader/pdf.js internals beyond the page/annotation
	// elements, which the reader must render anyway to display the annotation.
	const captureAreaImage = (annotation) => {
		try {
			const pageEl = document.querySelector(
				`.page[data-page-number="${annotation.page}"]`,
			) || document.querySelector(`[data-page-number="${annotation.page}"]`);
			if (!pageEl) return null;
			const canvas = pageEl.querySelector('canvas');
			if (!canvas || !canvas.width) return null;
			const annEl = pageEl.querySelector(`[data-annotation-id="${annotation.id}"]`)
				|| document.querySelector(`[data-annotation-id="${annotation.id}"]`);
			if (!annEl) return null;
			const cRect = canvas.getBoundingClientRect();
			const aRect = annEl.getBoundingClientRect();
			const scaleX = canvas.width / cRect.width;
			const scaleY = canvas.height / cRect.height;
			const x = Math.max(0, (aRect.left - cRect.left) * scaleX);
			const y = Math.max(0, (aRect.top - cRect.top) * scaleY);
			const w = Math.min(canvas.width - x, aRect.width * scaleX);
			const h = Math.min(canvas.height - y, aRect.height * scaleY);
			if (w < 4 || h < 4) return null;
			// 限宽 1600px 控制 data URL 体积
			const scale = Math.min(1, 1600 / w);
			const out = document.createElement('canvas');
			out.width = Math.round(w * scale);
			out.height = Math.round(h * scale);
			out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
			return out.toDataURL('image/png');
		}
		catch (e) {
			console.error('[paperweave] area capture failed', e);
			return null;
		}
	};

	// Called by the reader's annotation manager with the full objects of
	// created/updated annotations (already debounced ~1s upstream).
	const onSaveAnnotations = (annotations) => {
		try {
			const normalized = (Array.isArray(annotations) ? annotations : [])
				.map(normalizeAnnotation)
				.filter(Boolean);
			if (normalized.length) {
				postToHost({ type: 'annotationsChanged', payload: { annotations: normalized } });
				// 区域（图片）标注：截取区域图像发给宿主（问 AI 用）
				for (const a of normalized) {
					if (a.type === 'image' && a.page) {
						const dataUrl = captureAreaImage(a);
						if (dataUrl) {
							postToHost({ type: 'areaCapture', payload: { dataUrl, page: a.page, position: a.position } });
						}
					}
				}
			}
		}
		catch (e) {
			console.error('[paperweave] annotation sync error', e);
		}
	};

	const onDeleteAnnotations = (ids) => {
		try {
			const deletedIds = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string');
			if (deletedIds.length) {
				postToHost({ type: 'annotationsChanged', payload: { annotations: [], deletedIds } });
			}
		}
		catch (e) {
			console.error('[paperweave] annotation delete sync error', e);
		}
	};

	const installHostCommandListener = (reader) => {
		window.addEventListener('message', (event) => {
			if (event.source !== window.parent) {
				return;
			}
			const data = event.data;
			if (!data || data.source !== 'pw-host') {
				return;
			}
			try {
				if (data.type === 'jumpTo' && data.payload) {
					const { page, position } = data.payload;
					let navigation = null;
					if (position) {
						navigation = reader.navigate({ position });
					}
					else if (typeof page === 'number' && Number.isFinite(page)) {
						// Contract pages are 1-based; pdf-view navigate takes pageIndex.
						navigation = reader.navigate({ pageIndex: page - 1 });
					}
					// navigate is async; without a catch a failed jump is an
					// unhandled rejection in the iframe.
					Promise.resolve(navigation).catch((e) => {
						console.error('[paperweave] jumpTo failed', e);
					});
				}
				else if (data.type === 'clearSelection') {
					// clearSelection is a view method (pdf-view.js), not exposed on
					// Reader; _lastView is the currently focused view.
					reader._lastView?.clearSelection?.();
				}
			}
			catch (e) {
				console.error('[paperweave] host command error', data.type, e);
			}
		});
	};

	// --- reader creation ------------------------------------------------------

	const reader = window.createReader({
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
		onSaveAnnotations,
		onDeleteAnnotations,
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

	installSelectionHook(reader);
	installHostCommandListener(reader);
	// Reader#initializedPromise is never resolved upstream (this reader
	// version defines it but never calls _resolveInitializedPromise); the
	// per-view initializedPromise (pdf-view.js) is the real readiness signal.
	// The primary view is created asynchronously, so poll for it.
	(function waitForReady() {
		const view = reader._primaryView;
		if (view && view.initializedPromise) {
			view.initializedPromise.then(
				() => postToHost({ type: 'ready' }),
				(e) => console.error('[paperweave] reader view failed to initialize', e),
			);
		}
		else {
			setTimeout(waitForReady, 100);
		}
	})();
});
