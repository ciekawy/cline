import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ModelInfo, SambanovaModelId, sambanovaDefaultModelId, sambanovaModels } from "@shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "@/api/transform/openai-format"
import { ApiStream } from "@api/transform/stream"
import { convertToR1Format } from "@api/transform/r1-format"

interface SambanovaHandlerOptions {
	sambanovaApiKey?: string
	apiModelId?: string
}

export class SambanovaHandler implements ApiHandler {
	private options: SambanovaHandlerOptions
	private client: OpenAI | undefined

	constructor(options: SambanovaHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.sambanovaApiKey) {
				throw new Error("SambaNova API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.sambanova.ai/v1",
					apiKey: this.options.sambanovaApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating SambaNova client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const modelId = model.id.toLowerCase()

		if (modelId.includes("deepseek") || modelId.includes("qwen") || modelId.includes("qwq")) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create({
			model: this.getModel().id,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in sambanovaModels) {
			const id = modelId as SambanovaModelId
			return { id, info: sambanovaModels[id] }
		}
		return {
			id: sambanovaDefaultModelId,
			info: sambanovaModels[sambanovaDefaultModelId],
		}
	}
}
