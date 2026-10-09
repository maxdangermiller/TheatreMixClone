import React from 'react';

/*
 * Outline icons for the toolbar, drawn in the style of TheatreMix's toolbar
 * (white strokes, 24 × 24 grid). They use currentColor, so the button's
 * color / disabled opacity applies to them.
 */

const Icon = ({children, size = 28}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.6}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		{children}
	</svg>
);

export const NewShowIcon = () => (
	<Icon>
		<path d="M6 3h8l4 4v14H6z" />
		<path d="M14 3v4h4" />
	</Icon>
);

export const OpenShowIcon = () => (
	<Icon>
		<path d="M3 19V6a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v2" />
		<path d="M3 19l3-8h16l-3 8z" />
	</Icon>
);

export const SaveShowIcon = () => (
	<Icon>
		<path d="M4 4h13l3 3v13H4z" />
		<path d="M8 4v5h7V4" />
		<rect x="7" y="13" width="10" height="7" />
	</Icon>
);

export const UndoIcon = () => (
	<Icon>
		<path d="M9 14L4 9l5-5" />
		<path d="M4 9h10a6 6 0 0 1 0 12h-2" />
	</Icon>
);

export const RedoIcon = () => (
	<Icon>
		<path d="M15 14l5-5-5-5" />
		<path d="M20 9H10a6 6 0 0 0 0 12h2" />
	</Icon>
);

export const InsertCueIcon = () => (
	<Icon>
		<rect x="2" y="5" width="16" height="9" rx="1" />
		<circle cx="18" cy="17" r="4.5" />
		<path d="M18 15v4M16 17h4" />
	</Icon>
);

export const CloneCueIcon = () => (
	<Icon>
		<rect x="3" y="3" width="18" height="8" rx="1" />
		<rect x="3" y="13" width="18" height="8" rx="1" />
		<path d="M12 5.5v4M10.5 8l1.5 1.5L13.5 8" />
	</Icon>
);

export const DeleteCueIcon = () => (
	<Icon>
		<rect x="2" y="5" width="16" height="9" rx="1" />
		<circle cx="18" cy="17" r="4.5" />
		<path d="M16.5 15.5l3 3M19.5 15.5l-3 3" />
	</Icon>
);

export const AssignIcon = () => (
	<Icon>
		<path d="M4 20l1-4L16 5l3 3L8 19z" />
		<path d="M14 7l3 3" />
	</Icon>
);

export const FxColumnIcon = () => (
	<Icon>
		<path d="M5 2v20M5 2h4M5 22h4" />
		<text x="11" y="18" fontSize="8" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif">FX</text>
	</Icon>
);

export const PositionsColumnIcon = () => (
	<Icon>
		<path d="M5 2v20M5 2h4M5 22h4" />
		<path d="M15 21s-4-4.2-4-7.5a4 4 0 0 1 8 0c0 3.3-4 7.5-4 7.5z" />
		<circle cx="15" cy="13.5" r="1.4" />
	</Icon>
);

export const LockIcon = () => (
	<Icon>
		<rect x="5" y="11" width="14" height="10" rx="1" fill="currentColor" />
		<path d="M8 11V8a4 4 0 0 1 8 0v3" />
	</Icon>
);

export const UnlockIcon = () => (
	<Icon>
		<rect x="5" y="11" width="14" height="10" rx="1" />
		<path d="M8 11V8a4 4 0 0 1 7.5-2" />
	</Icon>
);

export const BackIcon = () => (
	<Icon>
		<path d="M15 4l-8 8 8 8" />
	</Icon>
);

export const GoIcon = () => (
	<Icon>
		<path d="M9 4l8 8-8 8" />
	</Icon>
);

export const ConsoleSetupIcon = () => (
	<Icon>
		<path d="M6 3v18M12 3v18M18 3v18" />
		<rect x="4" y="13" width="4" height="3" fill="currentColor" />
		<rect x="10" y="6" width="4" height="3" fill="currentColor" />
		<rect x="16" y="11" width="4" height="3" fill="currentColor" />
	</Icon>
);

export const QLabStatusIcon = () => (
	<Icon>
		<circle cx="11.5" cy="11.5" r="7" strokeWidth={3} />
		<path d="M16.5 16.5l4 4" strokeWidth={3} />
	</Icon>
);
