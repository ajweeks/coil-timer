import clsx from 'clsx';
import { Minus, X } from 'lucide-react';
import { ReactNode } from 'react';
import { closeWindow, minimizeWindow } from './native';

/** The corner the controls take up, in px, including their inset from the edges (matches the classes below) */
export const WINDOW_CONTROLS_WIDTH = 4 + 32 + 2 + 32;
export const WINDOW_CONTROLS_HEIGHT = 4 + 28;

interface WindowControlsProps {
  isVisible: boolean;
}

/** Minimize and close, for the desktop app's undecorated window. */
export const WindowControls = ({ isVisible }: WindowControlsProps) => (
  <nav
    aria-label="Window controls"
    className={clsx(
      'absolute top-1 right-1 z-30 flex flex-row gap-0.5',
      'transition-opacity duration-500',
      isVisible ? 'opacity-100 visible' : 'opacity-0 invisible',
    )}
  >
    <WindowButton label="Minimize" onClick={() => minimizeWindow().catch(() => {})}>
      <Minus size={16} />
    </WindowButton>
    <WindowButton
      label="Close"
      onClick={() => closeWindow().catch(() => {})}
      className="hover:bg-red-500! hover:text-white!"
    >
      <X size={16} />
    </WindowButton>
  </nav>
);

interface WindowButtonProps {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

const WindowButton = ({ label, onClick, className, children }: WindowButtonProps) => (
  <button
    aria-label={label}
    title={label}
    onClick={(e) => {
      // Don't count as a click on the background (which toggles the controls)
      e.stopPropagation();
      onClick();
    }}
    onDoubleClick={(e) => e.stopPropagation()}
    className={clsx(
      'flex items-center justify-center w-8 h-7 rounded-md cursor-pointer',
      'text-gray-500 dark:text-gray-400',
      'hover:text-gray-900 dark:hover:text-white hover:bg-black/10 dark:hover:bg-white/15',
      'active:scale-95 transition-colors duration-150',
      'focus-visible:outline-2 focus-visible:outline-gray-400',
      className,
    )}
  >
    {children}
  </button>
);
