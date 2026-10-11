import { APP } from "@/constants/app";
import { WORDMARK_CLASSNAME } from "@/constants/branding";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import type { AppWordmarkProps } from "@/types/branding";

export function AppWordmark({ className, ...props }: AppWordmarkProps) {
  return (
    <Text
      {...props}
      className={cn("text-[28px]", WORDMARK_CLASSNAME, className)}
    >
      {APP.name}
    </Text>
  );
}
