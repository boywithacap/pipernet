import { createContext, useContext } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * Lets a parent (e.g. `Button`) set the text classes for any `Text` rendered
 * inside it, without threading props. uniwind has no built-in text cascade, so
 * we provide one: a `Text` merges this context with its own `className`.
 */
export const TextClassContext = createContext<string | undefined>(undefined);

export type TextProps = RNTextProps & {
  className?: string;
};

export function Text({ className, children, ...props }: TextProps) {
  const contextClass = useContext(TextClassContext);

  return (
    <RNText
      className={cn('text-foreground text-base', contextClass, className)}
      {...props}
    >
      {children}
    </RNText>
  );
}
