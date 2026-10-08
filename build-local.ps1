param(
    # "" = CPU only, "cuda" = NVIDIA GPU
    [string]$Feature = "cuda"
)
$ErrorActionPreference = "Stop"
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
# Korean (CP949) system locale: force MSVC to read sources as UTF-8
$env:CFLAGS = "/utf-8"
$env:CXXFLAGS = "/utf-8"
$env:CL = "/utf-8"

if ($Feature -eq "cuda") {
    $env:CUDA_PATH = [Environment]::GetEnvironmentVariable("CUDA_PATH","Machine")
    # MSBuild's CUDA integration looks these up, not CUDA_PATH
    $env:CUDA_PATH_V12_9 = $env:CUDA_PATH
    $env:CudaToolkitDir = $env:CUDA_PATH + "\"
    $env:CUDAToolkit_ROOT = $env:CUDA_PATH
    # RTX 5060 Ti (Blackwell) = sm_120; build only that arch to keep compile time down
    $env:CUDAARCHS = "120"
    $env:CMAKE_CUDA_ARCHITECTURES = "120"
}

Set-Location $PSScriptRoot
if ($Feature) { cargo build --release -p llama-helper --features $Feature } else { cargo build --release -p llama-helper }
if ($LASTEXITCODE -ne 0) { throw "llama-helper build failed" }
New-Item -ItemType Directory -Force frontend\src-tauri\binaries | Out-Null
Copy-Item target\release\llama-helper.exe frontend\src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe -Force

Set-Location frontend
if ($Feature) { pnpm run "tauri:build:$Feature" } else { pnpm run tauri:build:cpu }
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
