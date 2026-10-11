import { Lucide, type LucideIconName } from '@react-native-vector-icons/lucide';
import type { ComponentProps } from 'react';

export type IconName = LucideIconName;

type IconProps = Omit<ComponentProps<typeof Lucide>, 'name'> & {
  name: IconName;
};

/** App-wide icon, drawn from the Lucide set. */
export function Icon({ name, size = 24, color, style, ...rest }: IconProps) {
  return (
    <Lucide
      name={name}
      size={size}
      color={color}
      style={[
        // Lucide.ttf has winAscent 1090 / descent 0 (units-per-em 1000), so the
        // natural text line box is ~9% taller than the glyph with the slack at
        // the bottom — icons drew high. Pin the box to exactly size×size and
        // let RN center the glyph run inside it.
        {
          width: size,
          height: size,
          lineHeight: size,
          textAlign: 'center',
          includeFontPadding: false,
        },
        style,
      ]}
      {...rest}
    />
  );
}
