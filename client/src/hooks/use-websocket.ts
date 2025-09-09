"use client"


import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"

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

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    token,
    eventId,
    onMessage,
    onConnect,
    onDisconnect,
    reconnectAttempts = 5,
    reconnectDelay = 3000,
  } = options;
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected")
  const [isConnected, setIsConnected] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const reconnectCountRef = useRef(0)
  const manualDisconnectRef = useRef(false)
  const currentEventIdRef = useRef<string | undefined>(eventId)
  const isInitializedRef = useRef(false)

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setConnectionStatus("disconnected")
    setIsConnected(false)
    reconnectCountRef.current = 0
  }, [])

  const connect = useCallback(() => {
    if (!token) return
    if (socketRef.current && socketRef.current.connected) return

    setConnectionStatus("connecting")

    // Build socket.io options
    const opts: any = {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      query: eventId ? { eventId } : undefined,
      reconnectionAttempts: reconnectAttempts,
      reconnectionDelay: reconnectDelay,
    }

    // Remove undefined query if no eventId
    if (!eventId) delete opts.query

    const url = window.location.origin
    const socket = io(url, opts)
    socketRef.current = socket

    socket.on("connect", () => {
      manualDisconnectRef.current = false
      setConnectionStatus("connected")
      setIsConnected(true)
      reconnectCountRef.current = 0
      onConnect?.()
    })

    socket.on("disconnect", (reason: string) => {
      setConnectionStatus("disconnected")
      setIsConnected(false)
      onDisconnect?.()
      // reconnect if not manual
      if (!manualDisconnectRef.current && reconnectCountRef.current < reconnectAttempts) {
        reconnectCountRef.current++
        setConnectionStatus("reconnecting")
        setTimeout(connect, reconnectDelay * Math.pow(1.5, reconnectCountRef.current - 1))
      }
    })

    socket.on("connect_error", () => {
      setConnectionStatus("disconnected")
      setIsConnected(false)
    })

    socket.onAny((event, ...args) => {
      // Ignore internal ping/pong
      if (event === "ping" || event === "pong") return
      onMessage?.({ type: event, ...args[0] })
    })
  }, [token, eventId, onMessage, onConnect, onDisconnect, reconnectAttempts, reconnectDelay])

  const sendMessage = useCallback((event: string, data?: any) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(event, data)
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

  return {
    connectionStatus,
    isConnected,
    sendMessage,
    connect,
    disconnect,
  }
}