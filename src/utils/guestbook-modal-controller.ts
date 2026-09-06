export const GUESTBOOK_MODAL_TOGGLE_EVENT = "firefly:guestbook-modal-toggle";

type GuestbookModalController = {
	toggle: () => void;
};

type GuestbookModalWindow = Window & {
	__fireflyGuestbookModalController?: GuestbookModalController;
	__fireflyGuestbookModalPendingToggle?: boolean;
	__fireflyGuestbookModalUnbind?: () => void;
};

function getWindow(windowRef?: Window): GuestbookModalWindow | null {
	if (windowRef) return windowRef as GuestbookModalWindow;
	if (typeof window === "undefined") return null;
	return window as GuestbookModalWindow;
}

export function requestGuestbookModalToggle(windowRef?: Window): void {
	const targetWindow = getWindow(windowRef);
	if (!targetWindow) return;

	const controller = targetWindow.__fireflyGuestbookModalController;
	if (controller) {
		controller.toggle();
		return;
	}

	targetWindow.__fireflyGuestbookModalPendingToggle = true;
	targetWindow.dispatchEvent(new CustomEvent(GUESTBOOK_MODAL_TOGGLE_EVENT));
}

export function bindGuestbookModalController(
	windowRef: Window,
	controller: GuestbookModalController,
): () => void {
	const targetWindow = getWindow(windowRef);
	if (!targetWindow) return () => {};

	targetWindow.__fireflyGuestbookModalUnbind?.();
	targetWindow.__fireflyGuestbookModalController = controller;

	const handleToggle = () => controller.toggle();
	targetWindow.addEventListener(GUESTBOOK_MODAL_TOGGLE_EVENT, handleToggle);

	if (targetWindow.__fireflyGuestbookModalPendingToggle) {
		targetWindow.__fireflyGuestbookModalPendingToggle = false;
		queueMicrotask(() => {
			if (targetWindow.__fireflyGuestbookModalController === controller) {
				controller.toggle();
			}
		});
	}

	const unbind = () => {
		targetWindow.removeEventListener(GUESTBOOK_MODAL_TOGGLE_EVENT, handleToggle);
		if (targetWindow.__fireflyGuestbookModalController === controller) {
			delete targetWindow.__fireflyGuestbookModalController;
		}
		if (targetWindow.__fireflyGuestbookModalUnbind === unbind) {
			delete targetWindow.__fireflyGuestbookModalUnbind;
		}
	};

	targetWindow.__fireflyGuestbookModalUnbind = unbind;
	return unbind;
}
