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
    for (const shortcut of shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const metaMatch = shortcut.meta === undefined || shortcut.meta === event.metaKey;
      const ctrlMatch = shortcut.ctrl === undefined || shortcut.ctrl === event.ctrlKey;

      if (!keyMatch || !metaMatch || !ctrlMatch) {
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
