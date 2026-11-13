GCP Production Architecture & Deployment Guide: Scaled Multi-Agent Minecraft Civilization (AIMinecraft)
This guide outlines a production-grade infrastructure blueprint, code-level integration patterns, deployment steps, and a financial model to host a 24/7/365 multi-agent Minecraft civilization running ~50 concurrent autonomous AI players powered by the Qwen2.5-72B-Instruct flagship model.

Part 1: GCP System & Qwen2.5 Inference Architecture
+----------------------------------+
                    |    Public Spectator Clients      |
                    +-----------------+----------------+
                                      | (TCP 25565 via Spectrum/Proxy)
                                      v
+------------------+     +------------+------------+     +-------------------+
|  Public Portal   | <---+  Cloud Load Balancer    +---> | Minecraft Server  |
|  (Cloud Run +    |     +-------------------------+     | (c3-standard-8 VM)|
|
生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

1. Compute Topology (Decoupled Production Design)
To ensure zero-interference operation, low latency, and high scalability, the architecture is completely decoupled into dedicated tiers:

A. Minecraft Server VM
Machine Type: c3-standard-8 (8 vCPUs, 32 GB RAM) powered by Intel 4th Gen Xeon Scalable processors (Sapphire Rapids).
Rationale: Minecraft's game loop (ticks) is highly single-thread bound. The c3 instance family offers excellent single-core performance (3.0 GHz+ base, high turbo) and DDR5 memory. Standard RAM allocation of 16-20 GB JVM heap allows ample head-room for Purpur/PaperMC optimization, handling 50 bots across dimensions and up to 100 concurrent spectator connections.
B. Node.js Bot Swarm Infrastructure
Machine Type: c3-standard-32 (32 vCPUs, 128 GB RAM) or GKE Autopilot.
Rationale: Mineflayer agents are CPU-bound during pathfinding (A* algorithm) and require isolated single-threaded Node.js runtimes. 50 Mineflayer processes at ~1.5–2.0 GB of RSS memory per bot require ~100 GB RAM. Allocating 32 vCPUs ensures non-blocking parallel processing for cognitive loops.
C. Shared State & Coordination Database
Task Queue: Cloud Memorystore for Redis (Basic Tier, M1 size, 1-3 GB RAM) serves as the sub-millisecond centralized broker for Leader-Worker task dispatching, heartbeat checks, and spatial coordination locks.
Long-Term Cognitive Memory: Cloud SQL for PostgreSQL (db-custom-4-16384 with 4 vCPUs, 16 GB RAM) with the pgvector extension. This replaces local JSON flat-files to store associative long-term memory embeddings (RAG) for multi-turn cognitive recall.
D. Public Web Portal & RadarMap
Ingestion: Cloud Run hosting the Portal Express Server (bot/portal/portal_server.js) connected via a WebSocket pipeline to the Minecraft Server's RadarMap API.
Caching & Shielding: Cloud Load Balancing with integrated Cloud CDN and Cloud Armor rules to cache static portal visualizers and block layer 7 DDoS floods.
2. Qwen2.5-72B-Instruct Inference Engine Design
Running 50 concurrent cognitive agents requires high-throughput, low-latency inference. We analyze the VRAM requirements and compute layouts for both quantized FP8 and full-precision BF16 serving:

VRAM Mathematical Formulation
The total VRAM ($V_{\text{total}}$) required by a vLLM serving instance is defined as:
$$V_{\text{total}} = V_{\text{model}} + V_{\text{KV_cache}} + V_{\text{overhead}}$$

Where:

$V_{\text{model}} = N \times B$
$N = 72.5 \times 10^9$ (parameters)
$B = \text{precision bytes}$ ($1$ byte for FP8, $2$ bytes for BF16)
$V_{\text{KV_cache}} = 2 \times L \times H \times A \times S \times C \times B$
$L$: Layers ($80$ for Qwen2.5-72B)
$H$: Hidden Size ($8192$)
$A$: Attention Heads (Grouped Query Attention reduces this. KV channels/group = $1024$)
$S$: Max Context window ($32,768$ tokens standard, capped to $8,192$ for performance)
$C$: Concurrency (Max concurrent active generations = $50$)
Hardware Configurations
Option 1: Quantized FP8/AWQ on 4x NVIDIA L4 (96GB VRAM)
VRAM Available: $4 \times 24\text{ GB} = 96\text{ GB}$
VRAM Model Weights (FP8): $\sim 73\text{ GB}$
VRAM left for KV Cache/Overhead: $\sim 23\text{ GB}$
Result: Sufficient for 50 concurrent agents using vLLM prefix caching, which stores system prompts and common persona templates once.
Option 2: High-Throughput BF16 on 2x NVIDIA A100 (160GB VRAM)
VRAM Available: $2 \times 80\text{ GB} = 160\text{ GB}$
VRAM Model Weights (BF16): $\sim 145\text{ GB}$
VRAM left for KV Cache/Overhead: $\sim 15\text{ GB}$
Result: Ideal for uncompressed token generation, maximum reasoning fidelity, and low latency.
Concurrency and Cognitive Ticks Calculation
Instead of invoking the LLM sequentially, agents operate on a tiered cognitive tick layout:

Reactive JS Layer: Standard movement, combat, and obstacle avoidance run at 20Hz (50ms) in Mineflayer.
Tier 2 Workers Cognitive Tick: LLM evaluations (Qwen2.5-72B) trigger every 30 seconds or upon explicit events (e.g., resource gathered, hostile target detected).
Tier 1 Leaders Cognitive Tick: Long-term planning, team coordination, and strategic adjustments trigger every 60 seconds.
$$\text{Total Requests/Min} = \left(\frac{43 \text{ Workers}}{30/60} \right) + \left(\frac{7 \text{ Leaders}}{60/60} \right) = 86 + 7 = 93 \text{ requests per minute}$$

At an average of 1,200 input tokens (context, schema, memories) and 150 output tokens per request:
$$\text{Aggregate Output Throughput} = \frac{93 \times 150}{60} = 232.5 \text{ Tokens/Second}$$

By utilizing vLLM multi-query attention with automatic Prefix Caching, identical prompt fragments (system rules, entity lists, role schemas) are computed once and reused across all concurrent requests, reducing active input processing load by up to 80%.

Part 2: Zero-Interference Spectator Engineering
To allow infinite public spectator access without degrading the performance of our 50 autonomous agents, we must enforce strict physical and logical boundary isolation.

1. Server & Spawning Configurations
Modify the following files in your PaperMC directory to isolate spectators from the server's spawning engine and tick loops:

paper-global.yml
# Isolate world generation and tick load from Spectator entities
world-settings:
  default:
    spectator-entities:
      allow-spectator-generating-chunks: false
      allow-spectator-activating-entities: false
    chunks:
      auto-organize-player-chunks: true
    anticheat:
      obfuscation:

生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

paper-world-defaults.yml
# Block spectators from impacting mob caps and spawn dynamics
world-settings:
  default:
    entities:
      spawning:
        count-all-active-players-for-spawning: false # Only count Survival-mode entities (AI bots)
    players:
      sleep-percentage: 100
    player-connection:
      keep-alive-interval: 30
生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

server.properties
# Force Spectator Mode on all human logins
gamemode=spectator
force-gamemode=true
pvp=false
difficulty=hard
allow-flight=true
max-players=100
enable-query=true
生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

2. LuckPerms Spectator Lockdowns
Apply a strict permission structure to strip Spectators of any interactive capabilities:

# Create spectator group and remove all interactive permissions
/lp create group spectator
/lp group spectator permission set minecraft.command.tell false
/lp group spectator permission set minecraft.command.me false
/lp group spectator permission set Essentials.build false
/lp group spectator permission set Essentials.chat false
/lp group spectator permission set Essentials.interact false

# Assign default join group
/lp default group spectator
生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

3. Mineflayer AI Blindness Filtering
To prevent bots from detecting, interacting with, or generating memories about public human spectators, the cognitive loop (bot/brain.js and bot/index.js) must clean its environment arrays.

Implement this filtering middleware inside the bot's tick update function:

// Filter Spectators from Bot's Perception Array
function cleanPerceivedEntities(bot) {
  const sanitizedPlayers = {};
  const sanitizedEntities = {};

  // 1. Sanitize Players (Tab List / Player States)
  for (const [username, player] of Object.entries(bot.players)) {
    // Exclude players in SPECTATOR (gamemode === 3)
    if (player.gamemode !== 3) {
      sanitizedPlayers[username] = player;

生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

Part 3: Step-by-Step GCP Deployment & 365-Day Operations Guide
1. Networking & Security
Run these commands to provision a secure VPC, subnets, and Cloud Armor rule profiles:

# 1. Create the Custom VPC network
gcloud compute networks create minecraft-civilization-vpc \
    --subnet-mode=custom \
    --bgp-routing-mode=regional

# 2. Create the regional subnet
gcloud compute networks subnets create us-central1-subnet \
    --network=minecraft-civilization-vpc \
    --region=us-central1 \
    --range=10.0.1.0/24 \

生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

2. GPU Quota & vLLM Deployment
Fetching Model Weights & Deploying vLLM Engine
To deploy Qwen2.5-72B-Instruct FP8, run the following to spawn a standard g2-standard-48 instance (with 4x NVIDIA L4 GPUs) utilizing an attached 200 GB local scratch disk for fast models weights load time:

# Create vLLM Host Instance
gcloud compute instances create vllm-qwen-inference \
    --project=tohostudio \
    --zone=us-central1-a \
    --machine-type=g2-standard-48 \
    --maintenance-policy=TERMINATE \
    --create-disk=auto-delete=yes,boot=yes,device-name=boot,image-family=common-cu-12-1-debian-11,image-project=deeplearning-platform-release,size=100,type=pd-ssd \
    --create-disk=device-name=model-storage,size=300,type=pd-balanced \
    --metadata=install-nvidia-driver=true


生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

3. Storage & 365-Day World Backups
Backup Lifecycle Policy (gcs_lifecycle.json)
Configure an automatic multi-tier GCS lifecycle policy to reduce storage costs over 365 days:

{
  "rule": [
    {
      "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
      "condition": {"age": 30}
    },
    {
      "action": {"type": "SetStorageClass", "storageClass": "ARCHIVE"},
      "condition": {"age": 90}
    },

生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

Apply this policy to your GCS backup bucket:

gcloud storage buckets create gs://aiminecraft-backups-tohostudio --location=us-central1
生成されたコードには、ここに示されていないライセンス制限が適用される場合があります。コードを使用する際は十分にご注意ください。詳細 

