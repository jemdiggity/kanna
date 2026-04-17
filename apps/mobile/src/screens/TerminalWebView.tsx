import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { TaskTerminalStatus } from "../state/sessionStore";
import {
  buildTerminalDocument,
  buildTerminalUpdateScript
} from "./buildTerminalDocument";

interface TerminalWebViewProps {
  output: string;
  status: TaskTerminalStatus;
  fullscreen?: boolean;
}

const FULLSCREEN_BOTTOM_INSET = 132;

export function TerminalWebView({
  output,
  status,
  fullscreen = false
}: TerminalWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const document = useMemo(
    () =>
      buildTerminalDocument({
        bottomInset: fullscreen ? FULLSCREEN_BOTTOM_INSET : 24
      }),
    [fullscreen]
  );
  const updateScript = useMemo(
    () =>
      buildTerminalUpdateScript({
        output,
        status
      }),
    [output, status]
  );

  useEffect(() => {
    webViewRef.current?.injectJavaScript(updateScript);
  }, [updateScript]);

  return (
    <View style={fullscreen ? styles.wrapFullscreen : styles.wrap}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        onLoadEnd={() => {
          webViewRef.current?.injectJavaScript(updateScript);
        }}
        scrollEnabled
        source={{ html: document }}
        style={fullscreen ? styles.webviewFullscreen : styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#050B14",
    borderColor: "#15243C",
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 260,
    overflow: "hidden"
  },
  wrapFullscreen: {
    backgroundColor: "#050B14",
    flex: 1,
    overflow: "hidden"
  },
  webview: {
    backgroundColor: "#050B14",
    minHeight: 260
  },
  webviewFullscreen: {
    backgroundColor: "#050B14",
    flex: 1
  }
});
