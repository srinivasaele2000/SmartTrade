import {Alert, Platform, type AlertButton} from 'react-native';

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const copy = [title, message].filter(Boolean).join('\n\n');
  const action = buttons?.find(button => button.style !== 'cancel');
  if (!action) window.alert(copy);
  else if (window.confirm(copy + '\n\n' + action.text + '?')) action.onPress?.();
}
