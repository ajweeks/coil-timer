import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

interface SettingsMenuProps {
  isVisible: boolean;
  children: ReactNode;
}

/** A cog button (bottom-left) that opens a small menu of settings and actions above it. */
export const SettingsMenu = ({ isVisible, children }: SettingsMenuProps) => {
  const [isOpenState, setIsOpen] = useState(false);
  const isOpen = isOpenState && isVisible;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={clsx(
        'absolute bottom-6 left-6 z-30',
        'transition-all duration-500',
        isVisible ? 'visible' : 'opacity-0 invisible',
      )}
      onClick={(e) => {
        e.stopPropagation();
        // Actions close the menu; toggles leave it open so the change is visible
        if ((e.target as Element).closest('[data-closes-menu]')) setIsOpen(false);
      }}
    >
      <div
        role="menu"
        aria-label="Settings"
        className={clsx(
          'absolute bottom-full left-0 mb-3 w-max min-w-48 py-1',
          'rounded-lg border border-gray-200 dark:border-gray-800',
          'bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm shadow-lg',
          'text-sm text-gray-700 dark:text-gray-300',
          'origin-bottom-left transition-[opacity,transform] duration-150',
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none invisible',
        )}
      >
        {children}
      </div>

      <button
        ref={triggerRef}
        type="button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Settings"
        className={clsx(
          'block cursor-pointer text-gray-700 dark:text-gray-400',
          'transition-[opacity,transform] duration-200 active:scale-95',
          isOpen ? 'opacity-100 rotate-45' : 'opacity-50 hover:opacity-100',
        )}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Settings size={24} />
      </button>
    </div>
  );
};

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  /** Present for toggles: shows a switch, and keeps the menu open when clicked */
  checked?: boolean;
  hint?: string;
}

export const MenuItem = ({ icon, label, onClick, checked, hint }: MenuItemProps) => {
  const isToggle = checked != null;
  return (
    <button
      type="button"
      role={isToggle ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isToggle ? checked : undefined}
      title={hint}
      data-closes-menu={isToggle ? undefined : true}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2 text-left whitespace-nowrap cursor-pointer',
        'hover:bg-gray-100 dark:hover:bg-gray-900 focus-visible:bg-gray-100 dark:focus-visible:bg-gray-900',
        'focus:outline-none',
      )}
      onClick={onClick}
    >
      <span className="shrink-0 text-gray-500 dark:text-gray-400 [&>svg]:size-[18px]">{icon}</span>
      <span className="grow">{label}</span>
      {isToggle && (
        <span
          aria-hidden
          className={clsx(
            'shrink-0 w-7 h-4 rounded-full p-0.5 transition-colors duration-200',
            checked ? 'bg-red-400 dark:bg-red-500' : 'bg-gray-300 dark:bg-gray-700',
          )}
        >
          <span
            className={clsx(
              'block size-3 rounded-full bg-white transition-transform duration-200',
              checked && 'translate-x-3',
            )}
          />
        </span>
      )}
    </button>
  );
};
