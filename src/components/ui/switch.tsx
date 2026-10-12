import { Switch as RNSwitch, type SwitchProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** Themed toggle — on-state uses the brand primary color. */
export function Switch(props: SwitchProps) {
  const theme = useTheme();
  return (
    <RNSwitch
      trackColor={{ false: theme.border, true: theme.primary }}
      thumbColor="#ffffff"
      ios_backgroundColor={theme.border}
      {...props}
    />
  );
}
