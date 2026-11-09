import { ReactNode, useContext, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { IconName } from '@/data/spaces';
import { colors, fonts, gradients, radius, shadow, space, type } from '@/theme';
import { Icon3D, Icon3DName } from './Icon3D';

// Expo apps are edge-to-edge on Android, so the window no longer resizes for
// the keyboard. Every screen with inputs needs a KeyboardAvoidingView with
// behavior="padding", offset by the navigation header above it.
export function useHeaderOffset() {
  return useContext(HeaderHeightContext) ?? 0;
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  header,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  header?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const headerOffset = useHeaderOffset();
  const inner = padded ? { paddingHorizontal: space.lg } : null;
  return (
    <LinearGradient colors={gradients.screen} style={styles.flex}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerOffset} style={styles.flex}>
        {header ? <View style={{ paddingTop: insets.top + space.sm }}>{header}</View> : <View style={{ height: space.sm }} />}
        {scroll ? (
          <ScrollView
            contentContainerStyle={[inner, { paddingBottom: space.xxl * 2 + insets.bottom, gap: space.md }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, inner]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// Bottom sheet that stays above the keyboard and the Android navigation bar.
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />
          {title ? <Text style={type.title}>{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }} style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Pill-style segmented control.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Thin progress bar.
export function Bar({ value, max, color, track = colors.surfaceSoft, height = 8 }: { value: number; max: number; color: string; track?: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (100 * value) / max)) : 0;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

// Large 3D icon + title, for the top of space and tool screens.
export function SpaceHeader({ icon, tint, eyebrow, title, body }: { icon: Icon3DName | string; tint: string; eyebrow?: string; title: string; body?: string }) {
  return (
    <LinearGradient colors={[tint, colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.spaceHeader}>
      <Icon3D name={icon} size={64} />
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? <Text style={type.label}>{eyebrow}</Text> : null}
        <Text style={type.title}>{title}</Text>
        {body ? <Text style={type.bodySoft}>{body}</Text> : null}
      </View>
    </LinearGradient>
  );
}

export function PageHeader({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.flex}>
        {eyebrow ? <Text style={type.label}>{eyebrow}</Text> : null}
        <Text style={type.hero}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

export function Card({
  children,
  tint,
  style,
  onPress,
}: {
  children: ReactNode;
  tint?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const body = <View style={[styles.card, tint ? { backgroundColor: tint } : null, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}
    >
      {body}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void | Promise<unknown>;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const v = buttonVariants[variant];
  // While an async onPress is still running, further taps are ignored, so a
  // quick double tap can't save something twice.
  const running = useRef(false);
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        if (running.current) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        const r = onPress();
        if (r && typeof (r as Promise<unknown>).finally === 'function') {
          running.current = true;
          (r as Promise<unknown>).catch(() => {}).finally(() => {
            running.current = false;
          });
        }
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        (pressed || disabled) && { opacity: 0.7 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  soft: { bg: colors.accentSoft, fg: colors.accent, border: colors.accentSoft },
  ghost: { bg: 'transparent', fg: colors.textSoft, border: colors.border },
  danger: { bg: '#FFE4E9', fg: colors.danger, border: '#FFE4E9' },
} as const;

export function Pill({
  label,
  active,
  onPress,
  tint,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        { backgroundColor: active ? tint ?? colors.accent : colors.surface },
        active ? null : { borderColor: colors.border, borderWidth: 1 },
      ]}
    >
      <Text style={[styles.pillText, { color: active && !tint ? colors.onAccent : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: 'top' }, props.style]}
      />
      {hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <View style={styles.row}>
        <Text style={[type.label, styles.flex]}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Blob({ icon, tint, color, size = 48 }: { icon: IconName; tint: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.6,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size * 0.46} color={color} />
    </View>
  );
}

export function Empty({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[type.bodySoft, { textAlign: 'center' }]}>{body}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: tint }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md + 2,
    gap: space.sm,
    ...shadow,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontFamily: fonts.bodyHeavy, fontSize: 16 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  empty: { alignItems: 'center', gap: space.sm, padding: space.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  stat: { flex: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  backdrop: { flex: 1, backgroundColor: '#2E2A3B55' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.xs },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceSoft, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.surface, ...shadow, shadowOpacity: 0.06, elevation: 1 },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.textMuted },
  spaceHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg, ...shadow },
});
