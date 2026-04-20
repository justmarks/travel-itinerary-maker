import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { signInWithGoogle, signOut } from "./src/auth/google";
import { fetchTrips } from "./src/api/client";
import type { Trip } from "@travel-app/shared";

interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthState {
  user: GoogleUser | null;
  accessToken: string | null;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ user: null, accessToken: null });
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result) {
        setAuth({ user: result.user, accessToken: result.accessToken });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSignOut = useCallback(() => {
    signOut();
    setAuth({ user: null, accessToken: null });
    setTrips([]);
  }, []);

  useEffect(() => {
    if (!auth.accessToken) return;

    setLoading(true);
    fetchTrips(auth.accessToken)
      .then(setTrips)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load trips"))
      .finally(() => setLoading(false));
  }, [auth.accessToken]);

  if (!auth.user) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="auto" />
        <Text style={styles.title}>✈️ Travel Itinerary Maker</Text>
        <Text style={styles.subtitle}>Sign in to view your trips</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={styles.signInButton}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.signInText}>Sign in with Google</Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>✈️ My Trips</Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.email}>{auth.user.email}</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.tripCard}>
              <Text style={styles.tripName}>{item.name}</Text>
              <Text style={styles.tripDates}>
                {item.startDate} – {item.endDate}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No trips yet. Create one on the web app.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111",
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    marginBottom: 32,
    marginTop: 8,
  },
  email: {
    fontSize: 13,
    color: "#888",
    marginBottom: 20,
  },
  error: {
    color: "#c00",
    marginBottom: 12,
    fontSize: 13,
  },
  signInButton: {
    backgroundColor: "#4285F4",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    alignSelf: "stretch",
  },
  signInText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  signOutText: {
    color: "#4285F4",
    fontSize: 14,
  },
  loader: {
    marginTop: 40,
  },
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tripName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
    marginBottom: 4,
  },
  tripDates: {
    fontSize: 13,
    color: "#666",
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    marginTop: 40,
    fontSize: 14,
  },
});
