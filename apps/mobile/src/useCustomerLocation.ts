import {useState} from 'react';
import {Platform} from 'react-native';

export type CustomerLocation = {label: string; filters: Record<string, string>};

export function useCustomerLocation() {
  const [location, setLocation] = useState<CustomerLocation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function manual(value: string) {
    const label = value.trim();
    if (!label || (/^[0-9\s]+$/.test(label) && !/^[1-9][0-9]{5}$/.test(label))) {
      setError('Enter a city, area or valid six-digit PIN code.');
      return false;
    }
    setError('');
    setLocation({label, filters: /^[1-9][0-9]{5}$/.test(label) ? {pincode: label} : {area: label}});
    return true;
  }
  async function gps() {
    setBusy(true);
    setError('');
    try {
      if (Platform.OS === 'web') {
        if (!window.isSecureContext || !navigator.geolocation) {
          setError('Location access needs a secure connection. Enter your city, area or PIN code instead.');
          return false;
        }
        const {coords} = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {timeout: 10000}));
        setLocation({label: 'Current location', filters: {lat: String(coords.latitude), lng: String(coords.longitude)}});
        return true;
      }
      const native = await import('expo-location');
      if (!(await native.requestForegroundPermissionsAsync()).granted) {
        setError('Location access is off. Enter your city, area or PIN code instead.');
        return false;
      }
      const {coords} = await native.getCurrentPositionAsync({accuracy: native.Accuracy.Balanced});
      let label = 'Current location';
      try {
        const [address] = await native.reverseGeocodeAsync(coords);
        if (address) label = [...new Set([address.district, address.city].filter(Boolean))].join(', ') || label;
      } catch {
        // Coordinates are usable even when reverse geocoding is unavailable.
      }
      setLocation({label, filters: {lat: String(coords.latitude), lng: String(coords.longitude)}});
      return true;
    } catch {
      setError('Couldn’t get your location. Enter your city, area or PIN code instead.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {location, busy, error, manual, gps};
}
