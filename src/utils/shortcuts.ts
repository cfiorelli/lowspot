import { isTypingTarget } from './format';

interface ShortcutConfig {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  handler: () => void;
  allowTyping?: boolean;
}

export const registerShortcuts = (shortcuts: ShortcutConfig[]) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    for (const shortcut of shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const metaMatch = shortcut.meta === undefined ? !event.metaKey : shortcut.meta === event.metaKey;
      const ctrlMatch = shortcut.ctrl === undefined ? !event.ctrlKey : shortcut.ctrl === event.ctrlKey;

      if (!keyMatch || !metaMatch || !ctrlMatch || event.altKey) {
        continue;
      }

      if (!shortcut.allowTyping && isTypingTarget(event.target)) {
        continue;
      }

      event.preventDefault();
      shortcut.handler();
      break;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
};
