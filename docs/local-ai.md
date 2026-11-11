# Local AI

## How a model gets into VRAM

1. You don't install anything into VRAM. You download the model to the SSD like any other file. When you start it, the software loads it into VRAM automatically.
2. The software does it. Ollama, LM Studio or vLLM sees the GPU and moves the model onto it, with no setup needed.
3. The process:
   1. Install Ollama (or LM Studio, which has a normal app window).
   2. Download a model, for example with `ollama pull gpt-oss:120b`, which saves it to the SSD.
   3. Run `ollama run gpt-oss:120b`, which loads it into VRAM and starts it.
   4. Chat with it, or point Diane at its local address instead of OpenAI.
4. When you stop it, VRAM is freed and the model stays on the SSD for next time.
5. To check it's on the GPU, run `ollama ps`. It shows "100% GPU", or a split such as "60% GPU / 40% CPU" if the model didn't fit.
