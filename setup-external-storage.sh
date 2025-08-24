#!/bin/bash

# Setup script for external storage drive configuration
# This script helps configure the Nostr relay to use an external storage drive

set -e

echo "🔧 Nostr Relay External Storage Setup"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
DRIVE_NAME="CarsonMinor1TB"
MOUNT_POINT="/media/$USER/$DRIVE_NAME"
STORAGE_DIR="$MOUNT_POINT/nostr-relay-storage"

echo -e "${YELLOW}This script will help you configure external storage for your Nostr relay.${NC}"
echo

# Step 1: Check if drive is already mounted
echo "🔍 Step 1: Checking if drive is mounted..."
if [ -d "$MOUNT_POINT" ] && mountpoint -q "$MOUNT_POINT"; then
    echo -e "${GREEN}✅ Drive '$DRIVE_NAME' is already mounted at $MOUNT_POINT${NC}"
else
    echo -e "${RED}❌ Drive '$DRIVE_NAME' is not mounted.${NC}"
    echo
    echo "Available drives:"
    lsblk -f
    echo
    echo -e "${YELLOW}Please mount your drive first using:${NC}"
    echo "  sudo mkdir -p $MOUNT_POINT"
    echo "  sudo mount /dev/sdX1 $MOUNT_POINT  # Replace sdX1 with your drive"
    echo
    echo "Or if it's already mounted somewhere else, update the MOUNT_POINT variable in this script."
    exit 1
fi

# Step 2: Create storage directories
echo
echo "📁 Step 2: Creating storage directories..."
if [ ! -d "$STORAGE_DIR" ]; then
    mkdir -p "$STORAGE_DIR"/{papers,comments,temp,backups}
    echo -e "${GREEN}✅ Created storage directories at $STORAGE_DIR${NC}"
else
    echo -e "${GREEN}✅ Storage directories already exist at $STORAGE_DIR${NC}"
fi

# Step 3: Set proper permissions
echo
echo "🔐 Step 3: Setting permissions..."
sudo chown -R $USER:$USER "$STORAGE_DIR"
chmod -R 755 "$STORAGE_DIR"
echo -e "${GREEN}✅ Permissions set for user $USER${NC}"

# Step 4: Create .env file if it doesn't exist
echo
echo "⚙️  Step 4: Configuring environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env file from .env.example${NC}"
fi

# Update .env file with correct paths
sed -i.bak "s|STORAGE_PATH=.*|STORAGE_PATH=$STORAGE_DIR|g" .env
sed -i.bak "s|DATABASE_PATH=.*|DATABASE_PATH=$STORAGE_DIR/relay.db|g" .env

echo -e "${GREEN}✅ Updated .env file with external storage paths${NC}"

# Step 5: Test configuration
echo
echo "🧪 Step 5: Testing configuration..."
if [ -w "$STORAGE_DIR" ]; then
    # Create a test file
    TEST_FILE="$STORAGE_DIR/test_write.txt"
    echo "Test write at $(date)" > "$TEST_FILE"
    if [ -f "$TEST_FILE" ]; then
        rm "$TEST_FILE"
        echo -e "${GREEN}✅ Write test successful${NC}"
    else
        echo -e "${RED}❌ Write test failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Storage directory is not writable${NC}"
    exit 1
fi

# Step 6: Display configuration summary
echo
echo "📋 Configuration Summary"
echo "======================="
echo "Drive name:       $DRIVE_NAME"
echo "Mount point:      $MOUNT_POINT"
echo "Storage path:     $STORAGE_DIR"
echo "Database path:    $STORAGE_DIR/relay.db"
echo
echo "Storage directories created:"
echo "  📄 Papers:      $STORAGE_DIR/papers"
echo "  💬 Comments:    $STORAGE_DIR/comments"
echo "  🗂️  Temp:        $STORAGE_DIR/temp"
echo "  💾 Backups:     $STORAGE_DIR/backups"

# Step 7: Final instructions
echo
echo -e "${GREEN}🎉 External storage setup complete!${NC}"
echo
echo "Next steps:"
echo "1. Build the relay:     npm run build"
echo "2. Start the relay:     npm start"
echo "3. Check admin panel:   http://your-ip:8080/admin.html"
echo
echo -e "${YELLOW}Note: All relay data (papers, database, etc.) will now be stored on the external drive.${NC}"
echo -e "${YELLOW}Make sure the drive is mounted before starting the relay!${NC}"

# Optional: Add to fstab for permanent mounting
echo
read -p "Would you like to add this drive to /etc/fstab for automatic mounting? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    DEVICE=$(findmnt -n -o SOURCE "$MOUNT_POINT")
    if [ -n "$DEVICE" ]; then
        FSTAB_LINE="$DEVICE $MOUNT_POINT auto defaults,user,nofail 0 2"
        echo "$FSTAB_LINE" | sudo tee -a /etc/fstab
        echo -e "${GREEN}✅ Added to /etc/fstab for automatic mounting${NC}"
    else
        echo -e "${RED}❌ Could not determine device for automatic mounting${NC}"
    fi
fi

echo
echo "Setup complete! 🚀"