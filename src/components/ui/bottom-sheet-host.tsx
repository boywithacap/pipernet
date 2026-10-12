import type { NativeBottomSheetHostProps } from './bottom-sheet-host.types';

/**
 * Android replaces this module with `bottom-sheet-host.android.tsx`.
 * Other platforms use their native implementation in `bottom-sheet.tsx`.
 */
export function NativeBottomSheetHost(_props: NativeBottomSheetHostProps) {
  return null;
}
