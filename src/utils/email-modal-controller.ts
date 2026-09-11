export const EMAIL_MODAL_TOGGLE_EVENT = "firefly:email-modal-toggle";

type EmailModalController = {
	toggle: () => void;
};

type EmailModalWindow = Window & {
	__fireflyEmailModalController?: EmailModalController;
	__fireflyEmailModalPendingToggle?: boolean;
	__fireflyEmailModalUnbind?: () => void;
};

function getWindow(windowRef?: Window): EmailModalWindow | null {
	if (windowRef) return windowRef as EmailModalWindow;
	if (typeof window === "undefined") return null;
	return window as EmailModalWindow;
}

export function requestEmailModalToggle(windowRef?: Window): void {
	const targetWindow = getWindow(windowRef);
	if (!targetWindow) return;

	const controller = targetWindow.__fireflyEmailModalController;
	if (controller) {
		controller.toggle();
		return;
	}

	targetWindow.__fireflyEmailModalPendingToggle = true;
	targetWindow.dispatchEvent(new CustomEvent(EMAIL_MODAL_TOGGLE_EVENT));
}

export function bindEmailModalController(
	windowRef: Window,
	controller: EmailModalController,
): () => void {
	const targetWindow = getWindow(windowRef);
	if (!targetWindow) return () => {};

	targetWindow.__fireflyEmailModalUnbind?.();
	targetWindow.__fireflyEmailModalController = controller;

	const handleToggle = () => controller.toggle();
	targetWindow.addEventListener(EMAIL_MODAL_TOGGLE_EVENT, handleToggle);

	if (targetWindow.__fireflyEmailModalPendingToggle) {
		targetWindow.__fireflyEmailModalPendingToggle = false;
		queueMicrotask(() => {
			if (targetWindow.__fireflyEmailModalController === controller) {
				controller.toggle();
			}
		});
	}

	const unbind = () => {
		targetWindow.removeEventListener(EMAIL_MODAL_TOGGLE_EVENT, handleToggle);
		if (targetWindow.__fireflyEmailModalController === controller) {
			delete targetWindow.__fireflyEmailModalController;
		}
		if (targetWindow.__fireflyEmailModalUnbind === unbind) {
			delete targetWindow.__fireflyEmailModalUnbind;
		}
	};

	targetWindow.__fireflyEmailModalUnbind = unbind;
	return unbind;
}
