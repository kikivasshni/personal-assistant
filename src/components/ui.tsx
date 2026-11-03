import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
import * as Haptics from 'expo-haptics';
import { colors, fonts, gradients, radius, shadow, space, type } from '@/theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
  header,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  header?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const inner = padded ? { paddingHorizontal: space.lg } : null;
  return (
    <LinearGradient colors={gradients.screen} style={styles.flex}>
      {header ? <View style={{ paddingTop: insets.top + space.sm }}>{header}</View> : <View style={{ height: space.sm }} />}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: space.xxl * 2, gap: space.md }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, inner]}>{children}</View>
      )}
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
  onPress: () => void;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
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
        <Text style={[styles.buttonText, { color: v.fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
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

export function Blob({ emoji, tint, size = 48 }: { emoji: string; tint: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.4,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
    </View>
  );
}

export function Empty({ emoji, title, body }: { emoji: string; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 36 }}>{emoji}</Text>
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
  stat: { flex: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
});
