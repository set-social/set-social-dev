import React from 'react';
import { Image, Pressable, View, type GestureResponderEvent } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { Text, Badge } from '../components/core';

// Reverted from the "same size as the other tabs" treatment — at 18px the
// chip and mark were too small to read as anything, and it made this look
// like a mistake rather than a hero tab. Back to a visibly larger chip,
// with no glow/ring behind it — the size and its own gradient fill are the
// only differentiators now.
const CHIP_SIZE = 38;
const RAISE_Y = -6;
const ARNOLD_MARK_SOURCE = require('../assets/branding/arnold-mark.png');
const ARNOLD_MARK_ASPECT = 733 / 753;
const ARNOLD_MARK_WIDTH = 19;

type ArnoldTabButtonProps = {
  onPress?: (e: GestureResponderEvent) => void;
  hasUnread?: boolean;
};

/**
 * The tab bar's hero slot — rendered as a filled gradient chip instead of a
 * stroked line icon, larger than the other four tabs' icons and raised
 * slightly above their baseline, so it reads as the featured, important one
 * out. No glow or ring behind it — just the size, the raise, and its own
 * gradient fill. The mark's own baked-in gradient stroke would wash out
 * against a gradient fill, so it's tinted to a flat `text.onAccent`
 * silhouette instead — same convention Button's primary variant uses for
 * icon/text on top of the accent gradient. MainTabs wires this up as
 * ArnoldTab's `tabBarButton`, with a `tabPress` listener that redirects to
 * the root Chat screen instead of ever actually focusing this tab.
 */
export function ArnoldTabButton({ onPress, hasUnread }: ArnoldTabButtonProps) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Chat with Arnold"
        hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        style={({ pressed }) => [
          { alignItems: 'center', transform: [{ translateY: RAISE_Y }] },
          pressed ? { opacity: 0.85 } : null,
        ]}
      >
        <View style={{ width: CHIP_SIZE, height: CHIP_SIZE }}>
          <View style={{ width: CHIP_SIZE, height: CHIP_SIZE, borderRadius: theme.radii.sm, overflow: 'hidden' }}>
            <LinearGradient
              colors={[theme.colors.accent.purple, theme.colors.accent.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={ARNOLD_MARK_SOURCE}
                style={{
                  width: ARNOLD_MARK_WIDTH,
                  height: ARNOLD_MARK_WIDTH / ARNOLD_MARK_ASPECT,
                  tintColor: theme.colors.text.onAccent,
                }}
                resizeMode="contain"
              />
            </LinearGradient>
          </View>
          <Badge visible={!!hasUnread} size={9} />
        </View>
        <Text
          variant="caption"
          style={{
            fontSize: 11,
            fontWeight: '800',
            marginTop: 4,
            color: theme.colors.accent.primary,
          }}
        >
          Arnold
        </Text>
      </Pressable>
    </View>
  );
}
