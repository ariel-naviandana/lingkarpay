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
 *                  kuorum: proposeClosePeriod, proposeReplaceMember, vote, executeProposal.
 * Kuorum: mayoritas mutlak (anggota/2 + 1); suara diteruskan backend (anggota tidak memegang dompet).
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
        bytes32 externalRef; // referensi dari backend (hash id kelompok di database); mencegah kelompok ganda
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

    enum ProposalKind { ClosePeriod, ReplaceMember }
    enum ProposalStatus { None, Open, Approved, Rejected, Executed }

    struct Proposal {
        uint256 circleId;
        ProposalKind kind;
        ProposalStatus status;
        uint32 periodNo; // ClosePeriod: periode yang akan ditutup
        uint32 approvals;
        uint32 rejections;
        uint64 deadline; // batas voting
        bytes32 oldMember; // ReplaceMember: anggota yang diganti
        bytes32 newMember; // ReplaceMember: pengganti
    }

    // ---------------------------------------------------------------- state
    address public operator;
    uint256 public circleCount;
    /// Referensi eksternal => id kelompok on-chain (0 = belum ada). Membuat pembuatan kelompok idempoten.
    mapping(bytes32 => uint256) public circleIdByRef;

    mapping(uint256 => Circle) private _circles;
    mapping(uint256 => bytes32[]) private _members; // indeks + 1 = urutan giliran = nomor periode penerima
    mapping(uint256 => mapping(bytes32 => bool)) private _isMember;
    mapping(uint256 => mapping(uint32 => Period)) private _periods;
    mapping(uint256 => mapping(uint32 => mapping(bytes32 => Payment))) private _payments;
    mapping(uint256 => mapping(uint32 => mapping(bytes32 => Penalty))) private _penalties;

    /// Lama voting sebuah usulan. Setelah itu suara ditolak dan usulan yang belum disetujui tidak berlaku.
    uint64 public constant VOTING_PERIOD = 3 days;
    uint256 public proposalCount;
    /// Usulan tutup periode terakhir untuk sebuah periode (0 = belum ada). Mencegah usulan ganda.
    mapping(uint256 => mapping(uint32 => uint256)) public proposalOfPeriod;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(bytes32 => bool)) private _voted; // proposalId => memberId => sudah memilih

    // --------------------------------------------------------------- events
    event CircleCreated(
        uint256 indexed circleId,
        bytes32 indexed externalRef,
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
    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed circleId,
        ProposalKind kind,
        uint32 periodNo,
        bytes32 oldMember,
        bytes32 newMember,
        uint64 deadline
    );
    event Voted(uint256 indexed proposalId, bytes32 indexed memberId, bool approve);
    event ProposalApproved(uint256 indexed proposalId);
    event ProposalRejected(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);
    event MemberReplaced(uint256 indexed circleId, bytes32 indexed oldMember, bytes32 indexed newMember, uint32 turnOrder);

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
    error RefAlreadyUsed(); // referensi eksternal sudah dipakai kelompok lain
    error ProposalExists(); // sudah ada usulan yang masih berlaku untuk periode itu
    error PeriodAlreadyComplete(); // semua sudah lunas, tidak perlu kuorum
    error MemberAlreadyPaidOut(); // giliran anggota itu sudah dicairkan/siap cair
    error ProposalNotOpen();
    error VotingClosed();
    error AlreadyVoted();
    error QuorumNotReached(); // usulan belum/tidak disetujui

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
        bytes32 externalRef,
        uint256 contributionAmount,
        uint32 memberCount,
        uint32 periodDays,
        uint16 penaltyPct
    ) external onlyOperator returns (uint256 circleId) {
        if (externalRef == bytes32(0) || contributionAmount == 0 || memberCount < 2 || periodDays == 0 || penaltyPct > 100) {
            revert InvalidParams();
        }
        if (circleIdByRef[externalRef] != 0) revert RefAlreadyUsed();
        circleId = ++circleCount;
        circleIdByRef[externalRef] = circleId;
        _circles[circleId] = Circle(contributionAmount, memberCount, periodDays, penaltyPct, 0, CircleStatus.Draft, externalRef);
        emit CircleCreated(circleId, externalRef, contributionAmount, memberCount, periodDays, penaltyPct);
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

    // ---------------------------------------------------------------- kuorum
    /// Usulan menutup periode yang berjalan meski iuran belum lengkap (supaya pencairan tidak tertahan).
    /// Tanpa usulan yang disetujui, penutupan saat iuran belum lengkap ditolak (closePeriod/markPayout).
    function proposeClosePeriod(uint256 circleId, uint32 periodNo) external onlyOperator returns (uint256 proposalId) {
        Circle storage c = _circles[circleId];
        if (c.status != CircleStatus.Active) revert WrongStatus();
        Period storage p = _periods[circleId][periodNo];
        if (p.status != PeriodStatus.Running) revert PeriodNotRunning();
        if (p.paidCount == c.memberCount) revert PeriodAlreadyComplete();
        uint256 existing = proposalOfPeriod[circleId][periodNo];
        if (existing != 0) {
            Proposal storage e = _proposals[existing];
            // Usulan yang masih terbuka (belum lewat batas waktu) atau sudah disetujui menghalangi usulan baru.
            if ((e.status == ProposalStatus.Open && block.timestamp <= e.deadline) || e.status == ProposalStatus.Approved) {
                revert ProposalExists();
            }
        }
        proposalId = _newProposal(circleId, ProposalKind.ClosePeriod, periodNo, bytes32(0), bytes32(0));
        proposalOfPeriod[circleId][periodNo] = proposalId;
    }

    /// Usulan mengganti anggota yang mundur. Pengganti mewarisi gilirannya. Hanya untuk anggota yang
    /// gilirannya belum dicairkan. Nominal, periode, penalti, dan urutan giliran tetap tidak berubah.
    function proposeReplaceMember(uint256 circleId, bytes32 oldMember, bytes32 newMember)
        external
        onlyOperator
        returns (uint256 proposalId)
    {
        if (_circles[circleId].status != CircleStatus.Active) revert WrongStatus();
        if (newMember == bytes32(0)) revert InvalidParams();
        if (_isMember[circleId][newMember]) revert AlreadyMember();
        uint32 turn = _turnOf(circleId, oldMember); // revert NotMember bila bukan anggota
        _requireNotPaidOut(circleId, turn);
        proposalId = _newProposal(circleId, ProposalKind.ReplaceMember, 0, oldMember, newMember);
    }

    /// Suara satu anggota (diteruskan backend setelah autentikasi). Satu anggota satu suara per usulan.
    /// Disetujui bila setuju >= kuorum; ditolak bila kuorum sudah mustahil tercapai.
    function vote(uint256 proposalId, bytes32 memberId, bool approve) external onlyOperator {
        Proposal storage pr = _proposals[proposalId];
        if (pr.status != ProposalStatus.Open) revert ProposalNotOpen();
        if (block.timestamp > pr.deadline) revert VotingClosed();
        if (!_isMember[pr.circleId][memberId]) revert NotMember();
        if (_voted[proposalId][memberId]) revert AlreadyVoted();

        _voted[proposalId][memberId] = true;
        if (approve) pr.approvals += 1;
        else pr.rejections += 1;
        emit Voted(proposalId, memberId, approve);

        uint32 memberCount = _circles[pr.circleId].memberCount;
        uint32 quorum = memberCount / 2 + 1;
        if (pr.approvals >= quorum) {
            pr.status = ProposalStatus.Approved;
            emit ProposalApproved(proposalId);
        } else if (pr.rejections > memberCount - quorum) {
            pr.status = ProposalStatus.Rejected;
            emit ProposalRejected(proposalId);
        }
    }

    /// Menjalankan usulan yang sudah disetujui. Usulan yang belum disetujui (kuorum tidak tercapai,
    /// ditolak, atau melewati batas waktu) tidak berlaku dan tidak bisa dieksekusi.
    function executeProposal(uint256 proposalId) external onlyOperator {
        Proposal storage pr = _proposals[proposalId];
        if (pr.status != ProposalStatus.Approved) revert QuorumNotReached();
        Circle storage c = _circles[pr.circleId];
        if (c.status != CircleStatus.Active) revert WrongStatus();

        pr.status = ProposalStatus.Executed;
        if (pr.kind == ProposalKind.ClosePeriod) {
            Period storage p = _periods[pr.circleId][pr.periodNo];
            if (p.status != PeriodStatus.Running) revert PeriodNotRunning();
            _close(pr.circleId, pr.periodNo, p);
        } else {
            _replaceMember(pr.circleId, pr.oldMember, pr.newMember, c.memberCount);
        }
        emit ProposalExecuted(proposalId);
    }

    function _newProposal(uint256 circleId, ProposalKind kind, uint32 periodNo, bytes32 oldMember, bytes32 newMember)
        private
        returns (uint256 proposalId)
    {
        proposalId = ++proposalCount;
        uint64 deadline = uint64(block.timestamp) + VOTING_PERIOD;
        _proposals[proposalId] = Proposal(circleId, kind, ProposalStatus.Open, periodNo, 0, 0, deadline, oldMember, newMember);
        emit ProposalCreated(proposalId, circleId, kind, periodNo, oldMember, newMember, deadline);
    }

    /// Nomor giliran (1..n) seorang anggota; revert NotMember bila bukan anggota.
    function _turnOf(uint256 circleId, bytes32 memberId) private view returns (uint32) {
        bytes32[] storage m = _members[circleId];
        for (uint32 i = 0; i < m.length; i++) {
            if (m[i] == memberId) return i + 1;
        }
        revert NotMember();
    }

    function _requireNotPaidOut(uint256 circleId, uint32 turn) private view {
        PeriodStatus ts = _periods[circleId][turn].status;
        if (ts == PeriodStatus.ReadyPayout || ts == PeriodStatus.Done) revert MemberAlreadyPaidOut();
    }

    function _replaceMember(uint256 circleId, bytes32 oldMember, bytes32 newMember, uint32 memberCount) private {
        if (_isMember[circleId][newMember]) revert AlreadyMember();
        uint32 turn = _turnOf(circleId, oldMember);
        _requireNotPaidOut(circleId, turn);

        _members[circleId][turn - 1] = newMember;
        _isMember[circleId][oldMember] = false;
        _isMember[circleId][newMember] = true;

        // Iuran yang sudah tercatat di periode berjalan ikut pindah ke anggota baru (paidCount tetap).
        // Riwayat periode yang sudah selesai tetap atas nama anggota lama.
        for (uint32 n = 1; n <= memberCount; n++) {
            PeriodStatus s = _periods[circleId][n].status;
            if ((s == PeriodStatus.Running || s == PeriodStatus.ReadyPayout) && _payments[circleId][n][oldMember].paid) {
                _payments[circleId][n][newMember] = _payments[circleId][n][oldMember];
                delete _payments[circleId][n][oldMember];
            }
        }
        emit MemberReplaced(circleId, oldMember, newMember, turn);
    }

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

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function hasVoted(uint256 proposalId, bytes32 memberId) external view returns (bool) {
        return _voted[proposalId][memberId];
    }

    /// Kuorum = mayoritas mutlak anggota.
    function quorumOf(uint256 circleId) external view returns (uint32) {
        return _circles[circleId].memberCount / 2 + 1;
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
