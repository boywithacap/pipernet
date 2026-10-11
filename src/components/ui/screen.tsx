import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

/**
 * Safe-area screen root that accepts a `className`. uniwind only patches core
 * `react-native` components, so we wrap safe-area-context's `SafeAreaView` with
 * `withUniwind` to enable Tailwind classes (and keep the `edges` prop).
 */
export const Screen = withUniwind(SafeAreaView);
