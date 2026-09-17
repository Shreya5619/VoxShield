/**
 * Skeleton Loader Component
 * Shows loading placeholder animations for better UX
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing
} from 'react-native';

interface SkeletonLoaderProps {
  /** Width of the skeleton (default: '100%') */
  width?: number | string;
  /** Height of the skeleton (default: 20) */
  height?: number;
  /** Style for the skeleton */
  style?: any;
  /** Animation duration in milliseconds (default: 1000) */
  duration?: number;
  /** Whether to show rounded corners (default: true) */
  rounded?: boolean;
}

const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width = '100%',
  height = 20,
  style,
  duration = 1000,
  rounded = true
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      animatedValue.setValue(0);
      Animated.timing(animatedValue, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(() => animate());
    };

    animate();

    return () => {
      animatedValue.stopAnimation();
    };
  }, [animatedValue, duration]);

  const interpolatedColor = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#f0f0f0', '#e0e0e0', '#f0f0f0']
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius: rounded ? 4 : 0,
          backgroundColor: interpolatedColor
        },
        style
      ]}
    />
  );
};

export const SkeletonRow: React.FC<{
  count?: number;
  height?: number;
  gap?: number;
}> = ({ count = 1, height = 20, gap = 8 }) => {
  return (
    <View style={[styles.row, { gap }]}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonLoader key={index} height={height} rounded />
      ))}
    </View>
  );
};

export const SkeletonCard: React.FC = () => {
  return (
    <View style={styles.card}>
      <SkeletonLoader height={100} rounded={false} />
      <View style={styles.cardContent}>
        <SkeletonLoader height={16} width="70%" />
        <SkeletonLoader height={12} width="40%" />
        <SkeletonRow count={3} height={12} gap={6} />
      </View>
    </View>
  );
};

export const SkeletonList: React.FC<{
  items?: number;
  itemHeight?: number;
}> = ({ items = 3, itemHeight = 60 }) => {
  return (
    <View style={styles.list}>
      {Array.from({ length: items }).map((_, index) => (
        <View key={index} style={styles.listItem}>
          <View style={styles.listItemIcon}>
            <SkeletonLoader height={40} width={40} rounded />
          </View>
          <View style={styles.listItemContent}>
            <SkeletonLoader height={16} width="60%" />
            <SkeletonLoader height={12} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContent: {
    padding: 12,
    gap: 8,
  },
  list: {
    gap: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    gap: 12,
  },
  listItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  listItemContent: {
    flex: 1,
    gap: 6,
  },
});

export default SkeletonLoader;