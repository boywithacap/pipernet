import { forwardRef, type ReactNode } from 'react';
import type { TextInput, TextInputProps } from 'react-native';

import {
  InputGroup,
  InputGroupInput,
  type InputGroupSize,
} from '@/components/ui/input-group';

export type InputProps = TextInputProps & {
  className?: string;
  /** Classes for the outer container (height, background, radius). */
  containerClassName?: string;
  /** Rendered before the text field (e.g. a country selector or icon). */
  left?: ReactNode;
  /** Rendered after the text field. */
  right?: ReactNode;
  size?: InputGroupSize;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { className, containerClassName, left, right, multiline, size, ...props },
  ref,
) {
  return (
    <InputGroup className={containerClassName} multiline={multiline} size={size}>
      {left}
      <InputGroupInput
        ref={ref}
        multiline={multiline}
        className={className}
        {...props}
      />
      {right}
    </InputGroup>
  );
});
