import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';

interface SettingsMenuProps {
  isVisible: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  children: ReactNode;
}

/** A cog button (bottom-left) that opens a small menu of settings and actions above it. */
export const SettingsMenu = ({ isVisible, isOpen: isOpenProp, onOpenChange, children }: SettingsMenuProps) => {
  const isOpen = isOpenProp && isVisible;
  const setIsOpenRef = useRef(onOpenChange);
  useEffect(() => {
    setIsOpenRef.current = onOpenChange;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpenRef.current(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setIsOpenRef.current(false);
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
        'absolute bottom-6 left-6 max-[240px]:bottom-3 max-[240px]:left-3 z-30',
        'transition-all duration-500',
        isVisible ? 'visible' : 'opacity-0 invisible',
      )}
      onClick={(e) => {
        e.stopPropagation();
        // Actions close the menu; toggles leave it open so the change is visible
        if ((e.target as Element).closest('[data-closes-menu]')) onOpenChange(false);
      }}
    >
      <div
        role="menu"
        aria-label="Settings"
        className={clsx(
          // Fit tiny windows: never wider or taller than the space beside/above the cog, and scroll if needed
          'absolute bottom-full left-0 mb-2 w-max max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto py-1',
          'max-[240px]:max-w-[calc(100vw-1.5rem)] max-[240px]:max-h-[calc(100vh-3rem)] max-[240px]:text-xs',
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
        onClick={() => onOpenChange(!isOpen)}
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
      title={hint ?? label}
      data-closes-menu={isToggle ? undefined : true}
      className={clsx(
        'w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer',
        'hover:bg-gray-100 dark:hover:bg-gray-900 focus-visible:bg-gray-100 dark:focus-visible:bg-gray-900',
        'focus:outline-none',
      )}
      onClick={onClick}
    >
      {/* Icons give way to the labels in very narrow windows */}
      <span className="shrink-0 text-gray-500 dark:text-gray-400 [&>svg]:size-[18px] max-[240px]:hidden">{icon}</span>
      <span className="grow min-w-0 break-words leading-tight">{label}</span>
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
