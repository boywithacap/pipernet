import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import {
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from 'react-native';

import { Text, type TextProps } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';

const continuous = { borderCurve: 'continuous' } as const;

export type InputGroupSize = 'default' | 'lg';

const InputGroupSizeContext = createContext<InputGroupSize>('default');

const textMetrics = {
  default: { fontSize: 16, lineHeight: 20 },
  lg: { fontSize: 18, lineHeight: 24 },
} as const;

export type InputGroupProps = ViewProps & {
  className?: string;
  children: ReactNode;
  multiline?: boolean;
  size?: InputGroupSize;
};

/** A shared container for editable text and inline add-ons. */
export function InputGroup({
  children,
  className,
  multiline = false,
  size = 'default',
  style,
  ...props
}: InputGroupProps) {
  return (
    <InputGroupSizeContext.Provider value={size}>
      <View
        className={cn(
          'flex-row gap-2 overflow-hidden rounded-card bg-input px-4',
          multiline
            ? 'min-h-24 items-start py-3'
            : size === 'lg'
              ? 'h-14 items-center'
              : 'h-12 items-center',
          className,
        )}
        style={[continuous, style]}
        {...props}
      >
        {children}
      </View>
    </InputGroupSizeContext.Provider>
  );
}

export type InputGroupInputProps = TextInputProps & { className?: string };

/** The editable part of an InputGroup. */
export const InputGroupInput = forwardRef<TextInput, InputGroupInputProps>(
  function InputGroupInput({ className, multiline, style, ...props }, ref) {
    const theme = useTheme();
    const size = useContext(InputGroupSizeContext);
    const metrics = textMetrics[size];

    return (
      <TextInput
        ref={ref}
        multiline={multiline}
        className={cn('flex-1 text-foreground', className)}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          {
            ...metrics,
            height: multiline ? undefined : metrics.lineHeight,
            padding: 0,
            margin: 0,
            includeFontPadding: false,
          },
          style,
        ]}
        placeholderTextColor={theme.mutedForeground}
        selectionColor={theme.primary}
        {...props}
      />
    );
  },
);

/** Text rendered beside an InputGroupInput with the exact same line metrics. */
export function InputGroupText({ className, style, ...props }: TextProps) {
  const size = useContext(InputGroupSizeContext);
  return (
    <Text
      className={className}
      style={[textMetrics[size], style]}
      {...props}
    />
  );
}
