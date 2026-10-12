import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const continuous = { borderCurve: 'continuous' } as const;

export type OtpInputProps = {
  /** Number of digits. @default 6 */
  length?: number;
  value: string;
  onChangeText: (value: string) => void;
  /** Called once the last digit is entered. */
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
};

/**
 * Segmented one-time-code input: a single hidden `TextInput` captures digits
 * while N boxes render the value and highlight the active slot. Replaces
 * HeroUI's `InputOTP` with a native, className-styled version.
 */
export function OtpInput({
  length = 6,
  value,
  onChangeText,
  onComplete,
  autoFocus,
  editable = true,
}: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChangeText(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  return (
    <Pressable
      className="flex-row justify-center gap-2"
      onPress={() => inputRef.current?.focus()}
      disabled={!editable}
    >
      {Array.from({ length }).map((_, i) => {
        const char = value[i] ?? '';
        const isActive =
          focused && (i === value.length || (value.length === length && i === length - 1));
        return (
          <View
            key={i}
            className={cn(
              'h-14 w-12 items-center justify-center rounded-tile border-2 bg-input',
              isActive ? 'border-primary' : 'border-transparent',
            )}
            style={continuous}
          >
            <Text className="text-2xl font-semibold">{char}</Text>
          </View>
        );
      })}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        editable={editable}
        // Hidden overlay: it captures input/paste but isn't visually rendered.
        className="absolute h-full w-full opacity-0"
      />
    </Pressable>
  );
}
