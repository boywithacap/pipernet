import {
  DropdownMenu,
  DropdownMenuItem,
  HorizontalDivider,
  Host,
  Icon as ComposeIcon,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import {
  MenuView,
  type MenuAction,
  type MenuComponentProps,
  type NativeActionEvent,
} from '@expo/ui/community/menu';
import { Fragment, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';

export type { MenuAction, NativeActionEvent };

type PlatformMenuProps = MenuComponentProps & {
  accessibilityLabel: string;
};

type AndroidMenuAction = MenuAction & {
  sectionStart?: boolean;
};

const checkIcon = require('@/assets/icons/check.xml');

export function PlatformMenu(props: PlatformMenuProps) {
  if (Platform.OS !== 'android') {
    const { accessibilityLabel: _accessibilityLabel, ...nativeProps } = props;
    return <MenuView {...nativeProps} />;
  }

  return <AndroidMenu {...props} />;
}

function AndroidMenu({
  actions,
  children,
  onPressAction,
  onOpenMenu,
  onCloseMenu,
  shouldOpenOnLongPress = false,
  style,
  testID,
  accessibilityLabel,
}: PlatformMenuProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const menuActions = useMemo(() => flattenActions(actions), [actions]);

  const setOpen = (next: boolean) => {
    if (expanded === next) return;
    setExpanded(next);
    (next ? onOpenMenu : onCloseMenu)?.();
  };

  const selectAction = (action: AndroidMenuAction) => {
    setOpen(false);
    hapticSelection();
    onPressAction?.({ nativeEvent: { event: action.id ?? action.title } });
  };

  return (
    <View collapsable={false} testID={testID} style={style}>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        {children}
      </View>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded }}
        hitSlop={4}
        style={StyleSheet.absoluteFill}
        onPress={shouldOpenOnLongPress ? undefined : () => setOpen(true)}
        onLongPress={shouldOpenOnLongPress ? () => setOpen(true) : undefined}
      />
      <Host style={styles.anchor} pointerEvents="none">
        <DropdownMenu
          expanded={expanded}
          onDismissRequest={() => setOpen(false)}
          color={theme.sheet}
        >
          <DropdownMenu.Items>
            {menuActions.map((action) => (
              <AndroidMenuItem
                key={action.id ?? action.title}
                action={action}
                onSelect={selectAction}
              />
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>
    </View>
  );
}

function AndroidMenuItem({
  action,
  onSelect,
}: {
  action: AndroidMenuAction;
  onSelect: (action: AndroidMenuAction) => void;
}) {
  const theme = useTheme();
  const destructive = !!action.attributes?.destructive;

  return (
    <Fragment>
      {action.sectionStart ? <HorizontalDivider color={theme.border} /> : null}
      <DropdownMenuItem
        enabled={!action.attributes?.disabled}
        elementColors={{
          textColor: destructive ? theme.destructive : theme.foreground,
          disabledTextColor: theme.mutedForeground,
          trailingIconColor: theme.primary,
        }}
        onClick={() => onSelect(action)}
      >
        <DropdownMenuItem.Text>
          <ComposeText style={{ typography: 'bodyLarge' }}>{action.title}</ComposeText>
        </DropdownMenuItem.Text>
        {action.state === 'on' ? (
          <DropdownMenuItem.TrailingIcon>
            <ComposeIcon source={checkIcon} size={20} />
          </DropdownMenuItem.TrailingIcon>
        ) : null}
      </DropdownMenuItem>
    </Fragment>
  );
}

function flattenActions(actions: MenuAction[], sectionStart = false): AndroidMenuAction[] {
  const flattened: AndroidMenuAction[] = [];

  actions.forEach((action) => {
    if (action.attributes?.hidden) return;

    if (action.subactions?.length) {
      flattened.push(
        ...flattenActions(
          action.subactions,
          action.displayInline ? flattened.length > 0 || sectionStart : sectionStart,
        ),
      );
      return;
    }

    flattened.push({
      ...action,
      sectionStart: sectionStart && flattened.length === 0,
    });
  });

  return flattened;
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 0,
  },
});
