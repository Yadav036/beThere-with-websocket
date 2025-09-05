"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting"

interface UseWebSocketOptions {
  token?: string
  eventId?: string
  onMessage?: (data: any) => void
  onConnect?: () => void
  onDisconnect?: () => void
  reconnectAttempts?: number
  reconnectDelay?: number
}

export function useWebSocket({
  token,
  eventId,
  onMessage,
  onConnect,
  onDisconnect,
  reconnectAttempts = 5,
  reconnectDelay = 3000,
}: UseWebSocketOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected")
  const [isConnected, setIsConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectCountRef = useRef(0)
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const manualDisconnectRef = useRef(false)

  const currentEventIdRef = useRef<string | undefined>(eventId)
  const isInitializedRef = useRef(false)

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true

    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)

    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect")
      wsRef.current = null
    }

    setConnectionStatus("disconnected")
    setIsConnected(false)
    reconnectCountRef.current = 0
  }, [])

  const connect = useCallback(() => {
    if (!token) return
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return

    setConnectionStatus("connecting")

    try {
      const wsUrl = new URL("/ws", window.location.origin)
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
      wsUrl.searchParams.set("token", token)
      if (eventId) wsUrl.searchParams.set("eventId", eventId)

      const ws = new WebSocket(wsUrl.toString())
      wsRef.current = ws

      ws.onopen = () => {
        manualDisconnectRef.current = false
        setConnectionStatus("connected")
        setIsConnected(true)
        reconnectCountRef.current = 0
        onConnect?.()

        // ping
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }))
        }, 30000)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type !== "ping") onMessage?.(data)
        } catch {
          console.warn("WebSocket: failed to parse message")
        }
      }

      ws.onclose = (event) => {
        setConnectionStatus("disconnected")
        setIsConnected(false)
        wsRef.current = null
        onDisconnect?.()

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)

        // reconnect if not manual
        if (!manualDisconnectRef.current && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current++
          setConnectionStatus("reconnecting")
          reconnectTimeoutRef.current = setTimeout(
            connect,
            reconnectDelay * Math.pow(1.5, reconnectCountRef.current - 1),
          )
        }
      }

      ws.onerror = () => {
        setConnectionStatus("disconnected")
        setIsConnected(false)
      }
    } catch {
      setConnectionStatus("disconnected")
      setIsConnected(false)
    }
  }, [token, eventId, onMessage, onConnect, onDisconnect, reconnectAttempts, reconnectDelay])

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    return false
  }, [])

  // initial connect
  useEffect(() => {
    if (token && !isInitializedRef.current) {
      isInitializedRef.current = true
      currentEventIdRef.current = eventId
      connect()
    } else if (!token) {
      disconnect()
      isInitializedRef.current = false
    }
    return () => disconnect()
  }, [token])

  // handle eventId changes
  useEffect(() => {
    if (!isInitializedRef.current || !token) return
    if (currentEventIdRef.current === eventId) return

    currentEventIdRef.current = eventId
    disconnect()
    setTimeout(() => {
      if (token) connect()
    }, 500)
  }, [eventId, token])

  return { connectionStatus, isConnected, sendMessage, connect, disconnect }
}
