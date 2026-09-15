/**
 * The shell: restore the key, then either the sign-in flow or the app.
 *
 * Two stacks. Signed out: the login page and, over it, the scanner as a
 * full-screen modal — a screen of its own so it has a bar, a close control,
 * and an Android back button that closes it rather than the app. Signed in:
 * the tab bar, and over it the screens you *enter* — a session, a routine —
 * which cover the tabs because each wants the bottom edge for a composer or a
 * switch. Starting a session is not a screen: the composer on the sessions
 * page is the launcher, as it is on the web. Writing a routine is a form, and
 * a form the platform presents as a sheet: Cancel on the left, Create on the
 * right, a swipe down to leave.
 *
 * The headers are the platform's. Every option that shapes them is in
 * `navigation/headers.ts`; nothing here paints a bar.
 */
import React, { useEffect } from 'react';
import { Platform, StatusBar, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from './state/auth';
import { LoginScreen, ScanScreen } from './screens/Login';
import { SessionDetailScreen } from './screens/SessionDetail';
import { RoutineScreen } from './screens/Routine';
import { RoutineEditorScreen } from './screens/RoutineEditor';
import { Tabs } from './navigation/Tabs';
import { stackOptions } from './navigation/headers';
import { GlassBar } from './ui/kit';
import { useTheme } from './theme';
import { linking } from './linking';

const Root = createNativeStackNavigator();

/**
 * A pushed page's bar in glass, over the page. Only where the bar is
 * transparent — Android paints its own.
 */
const glassBar = Platform.OS === 'ios' ? { headerBackground: () => <GlassBar /> } : {};

export default function App() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const { c } = theme;
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
      card: c.background,
      text: c.foreground,
      border: c.border,
      primary: c.primary,
    },
  };

  // Hold the shell until the keychain has answered, so a signed-in launch never
  // flashes the login screen. Painted, not null: a null frame between the
  // launch image and the first screen is a flash of the window's own colour.
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={navTheme} linking={linking}>
        <Root.Navigator screenOptions={stackOptions(theme)}>
          {credential ? (
            <>
              <Root.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
              <Root.Screen name="Session" component={SessionDetailScreen} options={{ title: '', ...glassBar }} />
              <Root.Screen name="Routine" component={RoutineScreen} options={{ title: '', ...glassBar }} />
              <Root.Screen
                name="RoutineEditor"
                component={RoutineEditorScreen}
                options={{ title: '', presentation: 'modal', ...glassBar }}
              />
            </>
          ) : (
            <>
              <Root.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
              <Root.Screen
                name="Scan"
                component={ScanScreen}
                options={{ title: 'Scan a pairing code', presentation: 'fullScreenModal' }}
              />
            </>
          )}
        </Root.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
