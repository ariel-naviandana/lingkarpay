// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/**
 * LingkarPay — KERANGKA AWAL (belum dikompilasi, belum diuji).
 *
 * Aturan arisan ditegakkan kontrak; uang tidak disimpan di sini (arsitektur pilihan A):
 * rupiah tetap di payment gateway, kontrak hanya mencatat iuran, giliran, penalti, dan pencairan.
 * Hanya `operator` (akun penanda tangan backend) yang boleh mencatat. Tanpa data pribadi:
 * anggota hanya dikenal lewat `memberId` (bytes32 dari memberRef samaran, mis. "m_ab12cd34").
 *
 * Yang SUDAH ada : createCircle, addMember, startCircle, recordPayment, applyPenalty, closePeriod,
 *                  markPayout, fungsi baca, event.
 * Yang TODO      : kuorum (propose/vote), opsional dan dikerjakan terakhir.
 * Lihat contracts/README.md dan docs/DESIGN.md bagian 7 untuk antarmuka dengan backend.
 */
contract LingkarPay {
    // ----------------------------------------------------------------- tipe
    enum CircleStatus { None, Draft, Active, Completed }
    enum PeriodStatus { Scheduled, Running, ReadyPayout, Done }

    struct Circle {
        uint256 contributionAmount; // rupiah bulat
        uint32 memberCount;
        uint32 periodDays;
        uint16 penaltyPct; // 0..100
        uint64 startTime; // 0 sampai kelompok dimulai
        CircleStatus status;
    }

    struct Period {
        PeriodStatus status;
        uint32 paidCount;
        bytes32 payoutRefHash; // diisi markPayout
    }

    struct Payment {
        bool paid;
        uint64 paidAt;
        bytes32 refHash; // Keccak-256 ringkasan transaksi gateway (bukti silang)
    }

    struct Penalty {
        bool applied;
        uint256 amount; // denda terutang (rupiah), dicatat sebagai audit; contract tidak memindahkan uang
    }

    // ---------------------------------------------------------------- state
    address public operator;
    uint256 public circleCount;

    mapping(uint256 => Circle) private _circles;
    mapping(uint256 => bytes32[]) private _members; // indeks + 1 = urutan giliran = nomor periode penerima
    mapping(uint256 => mapping(bytes32 => bool)) private _isMember;
    mapping(uint256 => mapping(uint32 => Period)) private _periods;
    mapping(uint256 => mapping(uint32 => mapping(bytes32 => Payment))) private _payments;
    mapping(uint256 => mapping(uint32 => mapping(bytes32 => Penalty))) private _penalties;

    // --------------------------------------------------------------- events
    event CircleCreated(
        uint256 indexed circleId,
        uint256 contributionAmount,
        uint32 memberCount,
        uint32 periodDays,
        uint16 penaltyPct
    );
    event MemberAdded(uint256 indexed circleId, bytes32 indexed memberId, uint32 turnOrder);
    event CircleStarted(uint256 indexed circleId, uint64 startTime);
    event PaymentRecorded(
        uint256 indexed circleId,
        uint32 indexed periodNo,
        bytes32 indexed memberId,
        bytes32 refHash,
        uint64 paidAt,
        bool late
    );
    event PenaltyApplied(uint256 indexed circleId, uint32 indexed periodNo, bytes32 indexed memberId, uint256 amount);
    event PeriodClosed(uint256 indexed circleId, uint32 indexed periodNo, bytes32 recipient);
    event PayoutMarked(uint256 indexed circleId, uint32 indexed periodNo, bytes32 recipient, bytes32 payoutRefHash);

    // --------------------------------------------------------------- errors
    error NotOperator();
    error InvalidParams();
    error WrongStatus();
    error CircleFull();
    error AlreadyMember();
    error NotMember();
    error PeriodNotRunning();
    error AlreadyRecorded();
    error PeriodNotComplete(); // belum semua anggota lunas
    error PeriodNotReady(); // periode belum/sudah tidak bisa dicairkan
    error NotLate(); // belum lewat tenggat
    error AlreadyPaid();
    error PenaltyAlreadyApplied();
    error NoPenalty(); // kelompok tanpa penalti (penaltyPct = 0)

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    // ------------------------------------------------- kelompok (sudah ada)
    /// Backend memanggil ini untuk job "createCircle". Mengembalikan id kelompok on-chain
    /// (dibaca worker dari event CircleCreated, lalu dilaporkan lewat markCircleCreated).
    function createCircle(
        uint256 contributionAmount,
        uint32 memberCount,
        uint32 periodDays,
        uint16 penaltyPct
    ) external onlyOperator returns (uint256 circleId) {
        if (contributionAmount == 0 || memberCount < 2 || periodDays == 0 || penaltyPct > 100) {
            revert InvalidParams();
        }
        circleId = ++circleCount;
        _circles[circleId] = Circle(contributionAmount, memberCount, periodDays, penaltyPct, 0, CircleStatus.Draft);
        emit CircleCreated(circleId, contributionAmount, memberCount, periodDays, penaltyPct);
    }

    /// Tambahkan anggota berurutan sesuai urutan giliran (turnOrder 1, 2, 3, ...).
    function addMember(uint256 circleId, bytes32 memberId) external onlyOperator {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Draft) revert WrongStatus();
        if (_members[circleId].length >= c.memberCount) revert CircleFull();
        if (_isMember[circleId][memberId]) revert AlreadyMember();
        _isMember[circleId][memberId] = true;
        _members[circleId].push(memberId);
        emit MemberAdded(circleId, memberId, uint32(_members[circleId].length));
    }

    /// Mengunci anggota, urutan giliran, dan parameter. Periode 1 langsung berjalan.
    function startCircle(uint256 circleId) external onlyOperator {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Draft) revert WrongStatus();
        if (_members[circleId].length != c.memberCount) revert InvalidParams();
        c.status = CircleStatus.Active;
        c.startTime = uint64(block.timestamp);
        _periods[circleId][1].status = PeriodStatus.Running;
        emit CircleStarted(circleId, c.startTime);
    }

    // ------------------------------------------------ pembayaran (sudah ada)
    /// Job "recordPayment". Satu iuran, satu catatan: pencatatan ganda ditolak.
    function recordPayment(
        uint256 circleId,
        uint32 periodNo,
        bytes32 memberId,
        bytes32 refHash,
        uint64 paidAt
    ) external onlyOperator {
        if (_circles[circleId].status != CircleStatus.Active) revert WrongStatus();
        if (!_isMember[circleId][memberId]) revert NotMember();
        Period storage p = _periods[circleId][periodNo];
        if (p.status != PeriodStatus.Running) revert PeriodNotRunning();
        Payment storage pay = _payments[circleId][periodNo][memberId];
        if (pay.paid) revert AlreadyRecorded();

        pay.paid = true;
        pay.paidAt = paidAt;
        pay.refHash = refHash;
        p.paidCount += 1;
        emit PaymentRecorded(circleId, periodNo, memberId, refHash, paidAt, paidAt > dueDate(circleId, periodNo));
    }

    // ------------------------------------------------- penalti dan pencairan
    /// Mencatat denda yang TERUTANG bagi anggota yang belum bayar setelah tenggat (catatan audit; contract
    /// tidak memindahkan uang, tagihan denda ditagih backend). Boleh dipanggil siapa pun, sekali per anggota
    /// per periode. Rumus sama dengan backend: ceil(iuran * penaltyPct / 100), seragam untuk semua anggota.
    function applyPenalty(uint256 circleId, uint32 periodNo, bytes32 memberId) external {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Active) revert WrongStatus();
        if (!_isMember[circleId][memberId]) revert NotMember();
        if (_periods[circleId][periodNo].status != PeriodStatus.Running) revert PeriodNotRunning();
        if (c.penaltyPct == 0) revert NoPenalty();
        if (block.timestamp <= dueDate(circleId, periodNo)) revert NotLate();
        if (_payments[circleId][periodNo][memberId].paid) revert AlreadyPaid();
        Penalty storage pen = _penalties[circleId][periodNo][memberId];
        if (pen.applied) revert PenaltyAlreadyApplied();

        uint256 amount = (c.contributionAmount * c.penaltyPct + 99) / 100;
        pen.applied = true;
        pen.amount = amount;
        emit PenaltyApplied(circleId, periodNo, memberId, amount);
    }

    /// Menutup periode: semua anggota harus lunas. Status menjadi ReadyPayout dan penerima ditentukan
    /// jadwal (recipientOf), bukan pilihan operator. Biasanya tidak perlu dipanggil langsung karena
    /// markPayout menutup periode sendiri; fungsi ini ada agar penutupan bisa dipisah (dan untuk jalur kuorum).
    function closePeriod(uint256 circleId, uint32 periodNo) external onlyOperator {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Active) revert WrongStatus();
        Period storage p = _periods[circleId][periodNo];
        if (p.status != PeriodStatus.Running) revert PeriodNotRunning();
        if (p.paidCount != c.memberCount) revert PeriodNotComplete();
        _close(circleId, periodNo, p);
    }

    /// Job "markPayout": mencatat bahwa pencairan sudah dijalankan di sisi gateway. Bila periode masih
    /// Running dan semua sudah lunas, periode ditutup di sini juga (keputusan desain 1). Lalu periode menjadi
    /// Done, periode berikutnya dibuka (Running), atau kelompok menjadi Completed di periode terakhir.
    function markPayout(uint256 circleId, uint32 periodNo, bytes32 payoutRefHash) external onlyOperator {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Active) revert WrongStatus();
        if (payoutRefHash == bytes32(0)) revert InvalidParams();
        Period storage p = _periods[circleId][periodNo];

        if (p.status == PeriodStatus.Running) {
            if (p.paidCount != c.memberCount) revert PeriodNotComplete();
            _close(circleId, periodNo, p);
        } else if (p.status != PeriodStatus.ReadyPayout) {
            revert PeriodNotReady(); // Scheduled (belum gilirannya) atau sudah Done
        }

        p.status = PeriodStatus.Done;
        p.payoutRefHash = payoutRefHash;
        emit PayoutMarked(circleId, periodNo, recipientOf(circleId, periodNo), payoutRefHash);

        if (periodNo < c.memberCount) {
            _periods[circleId][periodNo + 1].status = PeriodStatus.Running;
        } else {
            c.status = CircleStatus.Completed;
        }
    }

    function _close(uint256 circleId, uint32 periodNo, Period storage p) private {
        p.status = PeriodStatus.ReadyPayout;
        emit PeriodClosed(circleId, periodNo, recipientOf(circleId, periodNo));
    }

    /// TODO(smart-contract, opsional dan terakhir): kuorum. propose(circleId, kind) dan vote(proposalId, yes).
    /// Keputusan operasional saja (menunda pencairan karena iuran belum lengkap, mengganti anggota yang mundur).
    /// Kuorum tidak boleh mengubah parameter terkunci (nominal, periode, penalti, urutan giliran).
    /// Suara dari anggota diteruskan backend setelah autentikasi (anggota tidak memegang dompet).
    /// Jalur penutupan periode lewat kuorum akan memanggil _close tanpa syarat paidCount penuh.

    // ------------------------------------------------------------ fungsi baca
    function getCircle(uint256 circleId) external view returns (Circle memory) {
        return _circles[circleId];
    }

    function getMembers(uint256 circleId) external view returns (bytes32[] memory) {
        return _members[circleId];
    }

    function getPeriod(uint256 circleId, uint32 periodNo) external view returns (Period memory) {
        return _periods[circleId][periodNo];
    }

    function getPayment(uint256 circleId, uint32 periodNo, bytes32 memberId) external view returns (Payment memory) {
        return _payments[circleId][periodNo][memberId];
    }

    function getPenalty(uint256 circleId, uint32 periodNo, bytes32 memberId) external view returns (Penalty memory) {
        return _penalties[circleId][periodNo][memberId];
    }

    /// Tenggat periode = waktu mulai + periodNo * periodDays hari.
    function dueDate(uint256 circleId, uint32 periodNo) public view returns (uint64) {
        Circle storage c = _circles[circleId];
        return c.startTime + uint64(periodNo) * uint64(c.periodDays) * 1 days;
    }

    /// Penerima periode ditentukan urutan giliran yang terkunci.
    function recipientOf(uint256 circleId, uint32 periodNo) public view returns (bytes32) {
        bytes32[] storage m = _members[circleId];
        if (periodNo == 0 || periodNo > m.length) revert InvalidParams();
        return m[periodNo - 1];
    }

    /// Denda yang terutang saat ini (0 bila sudah bayar atau belum lewat tenggat).
    function penaltyDue(uint256 circleId, uint32 periodNo, bytes32 memberId) external view returns (uint256) {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Active) return 0;
        if (_payments[circleId][periodNo][memberId].paid) return 0;
        if (block.timestamp <= dueDate(circleId, periodNo)) return 0;
        return (c.contributionAmount * c.penaltyPct + 99) / 100;
    }
}
