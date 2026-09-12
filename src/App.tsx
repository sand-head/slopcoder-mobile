/**
 * The shell: restore the key, then either the login screen or the stack.
 *
 * Plain stack navigation. The web cockpit's horizontal pager is a
 * transcript↔workspace carousel *within* one screen, and the workspace panel is
 * not in this app — so there is nothing to page between.
 */
import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from './state/auth';
import { LoginScreen } from './screens/Login';
import { SessionsScreen } from './screens/Sessions';
import { SessionDetailScreen } from './screens/SessionDetail';
import { NewSessionScreen } from './screens/NewSession';
import { SettingsScreen } from './screens/Settings';
import { useTheme } from './theme';
import { linking } from './linking';

const Stack = createNativeStackNavigator();


export default function App() {
  const scheme = useColorScheme();
  const { c } = useTheme();
  const ready = useAuth(s => s.ready);
  const credential = useAuth(s => s.credential);
  const restore = useAuth(s => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: c.background,
      card: c.card,
      text: c.foreground,
      border: c.border,
      primary: c.primary,
    },
  };

  // Hold the shell until the keychain has answered, so a signed-in launch never
  // flashes the login screen.
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={navTheme} linking={linking}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {credential ? (
            <>
              <Stack.Screen name="Sessions" component={SessionsScreen} />
              <Stack.Screen name="Session" component={SessionDetailScreen} />
              <Stack.Screen name="NewSession" component={NewSessionScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
