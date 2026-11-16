import {useEffect, useRef, useState, type ComponentRef} from 'react';
import {Animated, AppState, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Image} from 'expo-image';

const themes = {emerald: '#104537', indigo: '#302a73', amber: '#783a0a', slate: '#243247', crimson: '#831f3d'};
const cta = {none: '', brand: 'Shop Brand ›', category: 'Browse Category ›', item: 'View Product ›', support_chat: 'Chat with Admin ›'};

export type DealerBanner = {
  id: number; title: string; subtitle: string; image_url: string | null;
  banner_type?: 'image' | 'text'; theme_preset?: keyof typeof themes; badge_text?: string;
  target_type: 'none' | 'brand' | 'category' | 'item' | 'support_chat';
  target_brand_id: number | null; target_category_id: number | null; target_item_id: number | null;
};

function TextBanner({banner, width, withDots}: {banner: DealerBanner; width: number; withDots: boolean}) {
  const actionLabel = cta[banner.target_type];
  const headlineSize = Math.min(34, Math.max(17, Math.round(width * 0.07)));
  return <View style={[styles.textCard, {backgroundColor: themes[banner.theme_preset ?? 'emerald'] ?? themes.emerald,
    paddingHorizontal: Math.round(width * 0.06), paddingBottom: withDots ? 27 : 10}]}>
    <View style={[styles.accent, {width: width * 0.62, height: width * 0.62, right: -width * 0.24, top: -width * 0.24}]} />
    <View style={[styles.outline, {width: width * 0.58, height: width * 0.58, right: -width * 0.20, bottom: -width * 0.36}]} />
    {(!!banner.badge_text || !!actionLabel) && <View style={styles.pills}>
      {!!banner.badge_text && <Text style={styles.badge} numberOfLines={1}>{banner.badge_text}</Text>}
      {!!actionLabel && <Text style={styles.cta} numberOfLines={1}>{actionLabel}</Text>}
    </View>}
    <Text style={[styles.headline, {fontSize: headlineSize, lineHeight: Math.round(headlineSize * 1.1)}]} numberOfLines={3}>{banner.title}</Text>
    {!!banner.subtitle && <Text style={styles.subtitle} numberOfLines={2}>{banner.subtitle}</Text>}
  </View>;
}

export default function DealerBannerCarousel({banners, base, token, onOpen}: {
  banners: DealerBanner[]; base: string; token: string; onOpen: (banner: DealerBanner) => void;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const position = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const pausedUntil = useRef(0);
  const touching = useRef(false);
  const count = banners.length;
  const key = banners.map(banner => banner.id).join(',');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state !== 'active') touching.current = false;
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    offset.current = 0;
    position.setValue(0);
    scroll.current?.scrollTo({x: 0, animated: false});
  }, [width, key, position]);
  useEffect(() => {
    if (!foreground || width <= 0 || count < 2) return;
    const timer = setInterval(() => {
      if (touching.current || Date.now() < pausedUntil.current) return;
      const index = Math.min(count - 1, Math.max(0, Math.round(offset.current / width)));
      scroll.current?.scrollTo({x: (index + 1) * width, animated: true});
    }, 4000);
    return () => clearInterval(timer);
  }, [count, foreground, width]);
  if (!count) return null;
  const release = () => { touching.current = false; pausedUntil.current = Date.now() + 3000; };
  return <View style={styles.hero} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && <ScrollView ref={scroll} horizontal pagingEnabled bounces={false}
      showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
      onTouchStart={() => {touching.current = true;}} onTouchEnd={release} onTouchCancel={release}
      onScrollBeginDrag={() => {touching.current = true;}} onScrollEndDrag={release}
      onScroll={event => {
        const x = event.nativeEvent.contentOffset.x;
        offset.current = x;
        position.setValue(x / width);
        if (count > 1 && x >= count * width - 1) {
          offset.current = 0;
          position.setValue(0);
          scroll.current?.scrollTo({x: 0, animated: false});
        }
      }}>
      {(count > 1 ? [...banners, banners[0]] : banners).map((banner, index) => {
        const action = banner.target_type !== 'none';
        const textOnly = banner.banner_type === 'text' || !banner.image_url;
        return <Pressable key={`${banner.id}-${index}`} style={{width, aspectRatio: 16 / 9}}
          accessible={index < count} importantForAccessibility={index === count ? 'no-hide-descendants' : 'auto'}
          accessibilityRole={action ? 'button' : textOnly ? 'text' : 'image'}
          accessibilityLabel={[banner.badge_text, banner.title, banner.subtitle, cta[banner.target_type]].filter(Boolean).join('. ') || 'Dealer promotion'}
          disabled={!action} onPress={() => onOpen(banner)}>
          {textOnly ? <TextBanner banner={banner} width={width} withDots={count > 1} /> : <>
            <Image source={{uri: base + banner.image_url, headers: {Authorization: `Bearer ${token}`}}}
              style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
            {!!banner.subtitle && <View style={[styles.caption, count > 1 && styles.captionWithDots]}>
              <Text style={styles.captionText} numberOfLines={2}>{banner.subtitle}</Text>
            </View>}
          </>}
        </Pressable>;
      })}
    </ScrollView>}
    {count > 1 && <View pointerEvents="none" style={styles.indicator}>
      {banners.map((banner, index) => {
        const range = Array.from({length: count + 1}, (_, i) => i);
        const active = (i: number) => i % count === index;
        return <Animated.View key={banner.id} style={[styles.dot, {
          width: position.interpolate({inputRange: range, outputRange: range.map(i => active(i) ? 18 : 6), extrapolate: 'clamp'}),
          opacity: position.interpolate({inputRange: range, outputRange: range.map(i => active(i) ? 1 : 0.55), extrapolate: 'clamp'}),
        }]} />;
      })}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  hero: {aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#e6eee9', elevation: 2},
  textCard: {flex: 1, justifyContent: 'center', paddingTop: 10, gap: 5, overflow: 'hidden'},
  accent: {position: 'absolute', borderRadius: 999, backgroundColor: '#ffffff18'},
  outline: {position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: '#ffffff4d'},
  pills: {flexDirection: 'row', alignItems: 'center', gap: 7},
  badge: {flexShrink: 1, overflow: 'hidden', borderRadius: 14, backgroundColor: '#fff', color: '#192431', paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '700'},
  cta: {marginLeft: 'auto', overflow: 'hidden', borderRadius: 14, backgroundColor: '#0004', color: '#fff', paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '700'},
  headline: {color: '#fff', fontWeight: '800'},
  subtitle: {color: '#fffdebef', fontSize: 13, lineHeight: 16},
  caption: {position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: '#10241fdb'},
  captionWithDots: {paddingBottom: 29},
  captionText: {color: '#fff', fontSize: 14, fontWeight: '600'},
  indicator: {position: 'absolute', bottom: 9, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 15, backgroundColor: '#10241fb3'},
  dot: {height: 6, borderRadius: 4, backgroundColor: '#fff'},
});
