import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const isNative = Capacitor.isNativePlatform();

export function hapticImpact(style: ImpactStyle = ImpactStyle.Light) {
  if (isNative) Haptics.impact({ style }).catch(() => {});
}

export function hapticNotification(type: NotificationType = NotificationType.Success) {
  if (isNative) Haptics.notification({ type }).catch(() => {});
}

export function hapticSelection() {
  if (isNative) Haptics.selectionStart().catch(() => {});
}

export { ImpactStyle, NotificationType };
