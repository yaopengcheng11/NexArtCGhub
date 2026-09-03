#!/usr/bin/env bash
# ============================================================
# 在 2GB 内存机器上加 4GB swap,显著降低 OOM 概率
# ============================================================
set -euo pipefail

SWAP_SIZE="4G"
SWAP_FILE="/swapfile"

# 检查是否已存在
if swapon --show | grep -q "${SWAP_FILE}"; then
    echo "Swap already enabled:"
    swapon --show
    exit 0
fi

# 1. 创建 swap 文件
fallocate -l ${SWAP_SIZE} ${SWAP_FILE}
chmod 600 ${SWAP_FILE}

# 2. 格式化为 swap
mkswap ${SWAP_FILE}

# 3. 启用
swapon ${SWAP_FILE}

# 4. 写 fstab 持久化
if ! grep -q "${SWAP_FILE}" /etc/fstab; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
fi

# 5. 调低 swap 使用倾向(内存吃紧时才用 swap,不是默认 60)
sysctl vm.swappiness=10
grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=10" >> /etc/sysctl.conf

# 6. 验证
echo "== Swap 配置结果 =="
free -h
swapon --show
cat /proc/sys/vm/swappiness