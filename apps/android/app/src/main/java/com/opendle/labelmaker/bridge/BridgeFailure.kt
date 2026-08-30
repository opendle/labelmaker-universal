package com.opendle.labelmaker.bridge

open class BridgeFailure(
    val code: String,
    override val message: String,
) : Exception(message)
